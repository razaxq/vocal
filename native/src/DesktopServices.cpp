#include "DesktopServices.h"
#include "Dictionary.h"
#include "NativeRelease.h"
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QProcess>
#include <QSaveFile>
#include <QSettings>
#include <QVersionNumber>
#include <memory>

DesktopServices::DesktopServices(QString directory, QObject *parent)
    : QObject(parent), m_directory(std::move(directory)) {
    const auto cache = QDir(m_directory).filePath("dictionary.json");
    const QStringList paths{
        cache, QDir(QCoreApplication::applicationDirPath()).filePath("resources/dictionaries/rime-ice/catalog.json"),
        QDir(QCoreApplication::applicationDirPath()).filePath("../../../resources/dictionaries/rime-ice/catalog.json")};
    for (const auto &path : paths) {
        auto metadata = Dictionary::inspect(path);
        if (!metadata.isEmpty()) {
            m_dictionaryPath = QFileInfo(path).absoluteFilePath();
            m_dictionary = metadata;
            break;
        }
    }
    m_update = {{"state", "idle"}, {"message", "尚未检查更新"}, {"available", false}};
    m_daily.setInterval(24 * 60 * 60 * 1000);
    connect(&m_daily, &QTimer::timeout, this, [this] { configure(m_settings); });
    m_daily.start();
}
bool DesktopServices::packaged() const {
    // Development uses Qt from its SDK. It must never overwrite an installed
    // Electron build or register an SDK-dependent binary for Windows startup.
    return QFile::exists(QDir(QCoreApplication::applicationDirPath()).filePath("native-release.json"));
}
void DesktopServices::configure(const QJsonObject &settings) {
    m_settings = settings;
    QSettings state(QDir(m_directory).filePath("maintenance.ini"), QSettings::IniFormat);
    const auto last = state.value("dictionaryChecked").toDateTime();
    if (settings["dictionaryAutoUpdate"].toBool(true) &&
        (!last.isValid() || last.daysTo(QDateTime::currentDateTimeUtc()) >= 7))
        updateDictionary();
}
void DesktopServices::updateDictionary() {
    if (m_downloadingDictionary)
        return;
    m_downloadingDictionary = true;
    m_dictionary["updating"] = true;
    emit changed();
    QNetworkRequest request(
        QUrl("https://raw.githubusercontent.com/razaxq/vocal/main/resources/dictionaries/rime-ice/catalog.json"));
    request.setTransferTimeout(30000);
    auto *reply = m_network.get(request);
    connect(reply, &QNetworkReply::downloadProgress, this, [reply](qint64 size, qint64 total) {
        if (size > 64 * 1024 * 1024 || total > 64 * 1024 * 1024)
            reply->abort();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        m_downloadingDictionary = false;
        m_dictionary["updating"] = false;
        auto fail = [&] {
            m_dictionary["error"] = "词库更新失败，继续使用现有词库";
            reply->deleteLater();
            emit changed();
        };
        if (reply->error() != QNetworkReply::NoError) {
            fail();
            return;
        }
        const auto bytes = reply->readAll();
        if (bytes.size() > 64 * 1024 * 1024) {
            fail();
            return;
        }
        QDir().mkpath(m_directory);
        const auto stage = QDir(m_directory).filePath("dictionary.next.json");
        QSaveFile file(stage);
        if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit()) {
            fail();
            return;
        }
        auto metadata = Dictionary::inspect(stage);
        if (metadata.isEmpty()) {
            QFile::remove(stage);
            fail();
            return;
        }
        QSaveFile target(QDir(m_directory).filePath("dictionary.json"));
        if (!target.open(QIODevice::WriteOnly) || target.write(bytes) != bytes.size() || !target.commit()) {
            QFile::remove(stage);
            fail();
            return;
        }
        QFile::remove(stage);
        m_dictionaryPath = target.fileName();
        m_dictionary = metadata;
        QSettings state(QDir(m_directory).filePath("maintenance.ini"), QSettings::IniFormat);
        state.setValue("dictionaryChecked", QDateTime::currentDateTimeUtc());
        reply->deleteLater();
        emit dictionaryChanged();
        emit changed();
    });
}
bool DesktopServices::setStartup(bool enabled, QString *error) {
    if (!packaged()) {
        *error = "开发版不支持开机自启";
        return false;
    }
#if defined(Q_OS_WIN)
    QSettings run("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", QSettings::NativeFormat);
    if (enabled)
        run.setValue("VocalNative",
                     '"' + QDir::toNativeSeparators(QCoreApplication::applicationFilePath()) + "\" --autostart");
    else
        run.remove("VocalNative");
    run.sync();
    if (run.status() != QSettings::NoError) {
        *error = "无法保存开机自启设置";
        return false;
    }
    return true;
#else
    *error = "此平台尚未支持开机自启";
    return false;
#endif
}
void DesktopServices::checkUpdates() {
    if (m_checking)
        return;
    QFile marker(QDir(QCoreApplication::applicationDirPath()).filePath("native-release.json"));
    const bool development = !marker.open(QIODevice::ReadOnly) ||
                             QJsonDocument::fromJson(marker.readAll()).object()["development"].toBool(true);
    if (development) {
        m_update = {{"state", "development"}, {"message", "开发版，请使用本地构建更新"}, {"available", false}};
        emit changed();
        return;
    }
    m_checking = true;
    m_update["state"] = "checking";
    m_update["message"] = "正在检查更新…";
    emit changed();
    QNetworkRequest request(QUrl("https://api.github.com/repos/razaxq/vocal/releases?per_page=100"));
    request.setRawHeader("Accept", "application/vnd.github+json");
    request.setRawHeader("User-Agent", "Vocal-Native");
    request.setTransferTimeout(15000);
    auto *reply = m_network.get(request);
    connect(reply, &QNetworkReply::downloadProgress, this, [reply](qint64 size, qint64 total) {
        if (size > 4 * 1024 * 1024 || total > 4 * 1024 * 1024)
            reply->abort();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply] {
        m_checking = false;
        const auto bytes = reply->readAll();
        const auto document = QJsonDocument::fromJson(bytes);
        if (reply->error() != QNetworkReply::NoError || !document.isArray() || bytes.size() > 4 * 1024 * 1024) {
            m_update["state"] = "error";
            m_update["message"] = "检查失败，请重试";
            reply->deleteLater();
            emit changed();
            return;
        }
        m_update = {{"state", "current"}, {"message", "已是最新版本"}, {"available", false}};
        const auto update = selectNativeRelease(document.array(), QCoreApplication::applicationVersion());
        if (!update.isEmpty())
            m_update = update;
        reply->deleteLater();
        emit changed();
        if (m_update["available"].toBool() && m_settings["autoUpdate"].toBool(true))
            installUpdate();
    });
}
void DesktopServices::installUpdate() {
    if (!packaged() || m_update["state"] != "available")
        return;
    const QUrl url(m_update["url"].toString());
    if (url.scheme() != "https" || url.host() != "github.com" ||
        !url.path().startsWith("/razaxq/vocal/releases/download/"))
        return;
    m_update["state"] = "downloading";
    m_update["message"] = "正在下载更新…";
    emit changed();
    const auto path = QDir(m_directory).filePath("Vocal-Native-Update.exe");
    auto file = std::make_shared<QSaveFile>(path);
    auto hash = std::make_shared<QCryptographicHash>(QCryptographicHash::Sha256);
    if (!file->open(QIODevice::WriteOnly)) {
        m_update["state"] = "available";
        emit failed("无法写入更新文件");
        emit changed();
        return;
    }
    QNetworkRequest request(url);
    request.setTransferTimeout(60000);
    auto *reply = m_network.get(request);
    connect(reply, &QNetworkReply::readyRead, this, [reply, file, hash] {
        const auto bytes = reply->readAll();
        hash->addData(bytes);
        if (file->size() + bytes.size() > 1024LL * 1024 * 1024 || file->write(bytes) != bytes.size())
            reply->abort();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, file, hash, path] {
        const auto tail = reply->readAll();
        hash->addData(tail);
        const bool writeOk = tail.isEmpty() || file->write(tail) == tail.size();
        const bool ok = reply->error() == QNetworkReply::NoError && writeOk &&
                        file->size() == m_update["size"].toLongLong() &&
                        hash->result().toHex() == m_update["digest"].toString().toLatin1() && file->commit();
        reply->deleteLater();
        if (!ok) {
            file->cancelWriting();
            m_update["state"] = "available";
            m_update["message"] = "更新下载失败，请重试";
            emit changed();
            return;
        }
        if (QProcess::startDetached(path, {})) {
            QCoreApplication::quit();
            return;
        }
        m_update["state"] = "available";
        m_update["message"] = "无法启动安装程序";
        emit changed();
    });
}
