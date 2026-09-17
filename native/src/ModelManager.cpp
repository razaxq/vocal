#include "ModelManager.h"
#include <QCryptographicHash>
#include <QDir>
#include <QJsonArray>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTimer>
#include <QtEndian>
#include <cstring>
#include <stdexcept>

namespace {
quint64 varint(const QByteArray &data, qsizetype &at) {
    quint64 value = 0;
    for (int shift = 0; shift < 64 && at < data.size(); shift += 7) {
        const auto b = quint8(data[at++]);
        value |= quint64(b & 127) << shift;
        if (!(b & 128))
            return value;
    }
    throw std::runtime_error("Invalid SentencePiece model");
}
QByteArray vocabFromModel(const QByteArray &data) {
    QByteArray output;
    for (qsizetype at = 0; at < data.size();) {
        const auto tag = varint(data, at);
        const int wire = tag & 7;
        if (wire == 0) {
            varint(data, at);
            continue;
        }
        if (wire == 5) {
            at += 4;
            continue;
        }
        if (wire == 1) {
            at += 8;
            continue;
        }
        if (wire != 2)
            throw std::runtime_error("Unsupported SentencePiece field");
        const auto length = varint(data, at);
        if (length > quint64(data.size() - at))
            throw std::runtime_error("Truncated SentencePiece field");
        const auto end = at + qsizetype(length);
        if ((tag >> 3) == 1) {
            QByteArray piece;
            float score = 0;
            while (at < end) {
                const auto field = varint(data, at);
                if ((field & 7) == 2) {
                    const auto size = varint(data, at);
                    if (size > quint64(end - at))
                        throw std::runtime_error("Invalid vocabulary");
                    if ((field >> 3) == 1)
                        piece = data.mid(at, size);
                    at += size;
                } else if ((field & 7) == 5) {
                    if (at + 4 > end)
                        throw std::runtime_error("Invalid score");
                    if ((field >> 3) == 2) {
                        quint32 bits = qFromLittleEndian<quint32>(data.constData() + at);
                        memcpy(&score, &bits, 4);
                    }
                    at += 4;
                } else if ((field & 7) == 0)
                    varint(data, at);
                else
                    throw std::runtime_error("Invalid vocabulary field");
            }
            if (!piece.isEmpty())
                output += piece + '\t' + QByteArray::number(score, 'g', 9) + '\n';
        }
        at = end;
    }
    return output;
}
} // namespace
ModelManager::ModelManager(QString root, QObject *parent, QJsonObject registry)
    : QObject(parent), m_catalog(std::move(root), std::move(registry)) {
    connect(&m_tar, &QProcess::readyReadStandardOutput, this, [this] {
        const auto bytes = m_tar.readAllStandardOutput();
        if (m_file.size() + bytes.size() > qint64(5) * 1024 * 1024 * 1024 || m_file.write(bytes) != bytes.size()) {
            m_tar.kill();
            fail("模型文件写入失败或过大");
        }
    });
    connect(&m_tar, &QProcess::finished, this, [this](int code, QProcess::ExitStatus status) {
        if (m_phase != "extracting")
            return;
        const auto tail = m_tar.readAllStandardOutput();
        if (!tail.isEmpty() && m_file.write(tail) != tail.size()) {
            fail("模型写入失败");
            return;
        }
        m_file.close();
        if (code || status != QProcess::NormalExit || QFileInfo(m_extractOutput).size() == 0) {
            fail("模型解压失败：" + QString::fromUtf8(m_tar.readAllStandardError()).left(300));
            return;
        }
        ++m_index;
        extractNext();
    });
    connect(&m_tar, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        if (m_phase == "extracting")
            fail("无法启动系统 tar 解压程序");
    });
}
ModelManager::~ModelManager() {
    cancel();
}
QVariantList ModelManager::models(const QString &group) const {
    auto list = m_catalog.models(group);
    for (auto &value : list) {
        auto row = value.toMap();
        const auto id = row["id"].toString();
        const auto previous = m_finished.value(id);
        for (auto it = previous.begin(); it != previous.end(); ++it)
            row[it.key()] = it.value();
        if (row["id"].toString() == m_id) {
            row["phase"] = m_phase;
            row["percent"] = m_percent;
            row["received"] = m_received;
            row["total"] = m_total;
            row["error"] = m_error;
        }
        if (m_queue.contains(id)) {
            row["phase"] = "queued";
            row["queuePosition"] = m_queue.indexOf(id) + 1;
            row["error"] = QString{};
        }
        qint64 bytes = 0;
        const auto entry = m_catalog.find(row["id"].toString());
        const auto files = entry["files"].toObject();
        for (auto it = files.begin(); it != files.end(); ++it)
            bytes += QFileInfo(m_catalog.file(entry, it.key())).size();
        row["bytes"] = bytes;
        value = row;
    }
    return list;
}
void ModelManager::download(const QString &id) {
    if ((m_active && m_id == id) || m_queue.contains(id))
        return;
    if (m_catalog.find(id).isEmpty()) {
        emit failed("未知模型");
        return;
    }
    m_finished.remove(id);
    m_queue.append(id);
    emit changed();
    startNext();
}
void ModelManager::startNext() {
    if (m_active || m_queue.isEmpty())
        return;
    const auto id = m_queue.takeFirst();
    m_entry = m_catalog.find(id);
    m_id = id;
    m_active = true;
    m_phase = "downloading";
    m_error.clear();
    m_percent = 0;
    m_received = m_total = 0;
    if (m_catalog.installed(m_entry)) {
        m_phase = "done";
        m_active = false;
        emit changed();
        emit completed(id);
        QTimer::singleShot(0, this, &ModelManager::startNext);
        return;
    }
    QDir().mkpath(m_catalog.root());
    m_stage = std::make_unique<QTemporaryDir>(QDir(m_catalog.root()).filePath(".download-XXXXXX"));
    if (!m_stage->isValid()) {
        fail("无法创建下载目录");
        return;
    }
    m_downloads.clear();
    m_extract.clear();
    m_index = 0;
    for (const auto &item : m_entry["downloads"].toArray())
        m_downloads.append(item.toObject());
    if (m_downloads.isEmpty())
        m_downloads.append(QJsonObject{{"url", m_entry["url"]}, {"file", "archive.tar.bz2"}});
    m_archive = m_stage->filePath("archive.tar.bz2");
    next();
}
void ModelManager::next() {
    if (m_index >= m_downloads.size()) {
        if (m_entry["archive"] == "files") {
            commit();
            return;
        }
        m_index = 0;
        const auto files = m_entry["files"].toObject();
        for (auto it = files.begin(); it != files.end(); ++it)
            m_extract.append(it.value().toString());
        const auto generated = m_entry["generateBpeVocab"].toObject();
        if (!generated.isEmpty()) {
            m_extract.removeAll(generated["to"].toString());
            m_extract.append(generated["from"].toString());
        }
        extractNext();
        return;
    }
    m_phase = "downloading";
    m_received = m_total = 0;
    m_percent = 0;
    emit changed();
    const auto item = m_downloads[m_index];
    m_file.setFileName(m_stage->filePath(item["file"].toString()));
    if (!m_file.open(QIODevice::WriteOnly)) {
        fail("无法写入模型文件");
        return;
    }
    QNetworkRequest request(QUrl(item["url"].toString()));
    request.setTransferTimeout(60000);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    m_reply = m_network.get(request);
    connect(m_reply, &QNetworkReply::readyRead, this, [this] {
        if (!m_reply)
            return;
        const auto bytes = m_reply->readAll();
        if (m_file.size() + bytes.size() > qint64(5) * 1024 * 1024 * 1024 || m_file.write(bytes) != bytes.size())
            fail("下载文件写入失败或过大");
    });
    connect(m_reply, &QNetworkReply::downloadProgress, this, [this](qint64 read, qint64 total) {
        m_received = read;
        m_total = qMax(qint64(0), total);
        m_percent = total > 0 ? read * 100. / total : 0;
        emit changed();
    });
    connect(m_reply, &QNetworkReply::finished, this, [this, item] {
        if (!m_reply)
            return;
        auto *reply = m_reply.data();
        m_reply = nullptr;
        const auto tail = reply->readAll();
        const bool wrote = tail.isEmpty() || m_file.write(tail) == tail.size();
        const bool ok = reply->error() == QNetworkReply::NoError && wrote;
        reply->deleteLater();
        m_file.close();
        if (!ok) {
            fail("模型下载失败，请重试");
            return;
        }
        if (item.contains("sha256")) {
            m_phase = "verifying";
            emit changed();
            QFile file(m_file.fileName());
            file.open(QIODevice::ReadOnly);
            QCryptographicHash hash(QCryptographicHash::Sha256);
            hash.addData(&file);
            if (file.size() != qint64(item["bytes"].toDouble()) ||
                hash.result().toHex() != item["sha256"].toString().toLatin1()) {
                fail("模型校验失败，请重新下载");
                return;
            }
        }
        ++m_index;
        next();
    });
}
void ModelManager::extractNext() {
    if (m_index >= m_extract.size()) {
        commit();
        return;
    }
    m_phase = "extracting";
    m_percent = m_index * 100. / m_extract.size();
    emit changed();
    const auto file = m_extract[m_index];
    // Never let an archive create paths, permissions, links or special files.
    // tar streams only one registry-selected member to stdout; C++ owns writes.
    m_extractOutput = m_stage->filePath(file);
    m_file.setFileName(m_extractOutput);
    if (!m_file.open(QIODevice::WriteOnly)) {
        fail("无法写入解压文件");
        return;
    }
    m_tar.start(QStandardPaths::findExecutable("tar"),
                {"-xOf", m_archive, "--", m_entry["dir"].toString() + '/' + file});
}
void ModelManager::commit() {
    try {
        const auto generated = m_entry["generateBpeVocab"].toObject();
        if (!generated.isEmpty()) {
            QFile input(m_stage->filePath(generated["from"].toString()));
            if (!input.open(QIODevice::ReadOnly))
                throw std::runtime_error("BPE model missing");
            QSaveFile output(m_stage->filePath(generated["to"].toString()));
            const auto vocab = vocabFromModel(input.readAll());
            if (vocab.isEmpty() || !output.open(QIODevice::WriteOnly) || output.write(vocab) != vocab.size() ||
                !output.commit())
                throw std::runtime_error("Cannot write BPE vocabulary");
        }
        const auto files = m_entry["files"].toObject();
        for (auto it = files.begin(); it != files.end(); ++it)
            if (QFileInfo(m_stage->filePath(it.value().toString())).size() <= 0)
                throw std::runtime_error("Model file missing");
        QFile::remove(m_archive);
        const auto destination = QDir(m_catalog.root()).filePath(m_entry["dir"].toString());
        if (QFileInfo::exists(destination)) {
            fail("模型目录已存在；请先删除未完整下载的模型");
            return;
        }
        if (!QDir().rename(m_stage->path(), destination)) {
            fail("无法安装模型");
            return;
        }
        m_stage->setAutoRemove(false);
        m_stage.reset();
        m_phase = "done";
        m_percent = 100;
        m_active = false;
        emit changed();
        emit completed(m_id);
        QTimer::singleShot(0, this, &ModelManager::startNext);
    } catch (const std::exception &error) {
        fail(QString::fromUtf8(error.what()));
    }
}
void ModelManager::abortActive() {
    if (m_reply) {
        auto *reply = m_reply.data();
        m_reply = nullptr;
        disconnect(reply, nullptr, this, nullptr);
        reply->abort();
        reply->deleteLater();
    }
    if (m_tar.state() != QProcess::NotRunning) {
        m_tar.kill();
        m_tar.waitForFinished(3000);
    }
    m_file.close();
    m_stage.reset();
    m_active = false;
}
void ModelManager::cancel(const QString &id) {
    if (id.isEmpty())
        m_queue.clear();
    else if (m_queue.removeAll(id)) {
        m_finished[id] = {{"phase", "cancelled"}};
        emit changed();
        return;
    } else if (id != m_id || !m_active || m_phase == "deleting")
        return;
    m_phase = "cancelled";
    abortActive();
    m_finished[m_id] = {{"phase", "cancelled"}};
    emit changed();
    if (!id.isEmpty())
        QTimer::singleShot(0, this, &ModelManager::startNext);
}
void ModelManager::fail(const QString &message) {
    m_phase = "error";
    abortActive();
    m_phase = "error";
    m_error = message;
    m_finished[m_id] = {{"phase", "error"}, {"error", message}};
    emit changed();
    emit failed(message);
    QTimer::singleShot(0, this, &ModelManager::startNext);
}
void ModelManager::remove(const QString &id) {
    if (busy()) {
        emit failed("请等待当前模型任务完成");
        return;
    }
    const auto entry = m_catalog.find(id);
    if (entry.isEmpty())
        return;
    const auto root = QFileInfo(m_catalog.root()).canonicalFilePath();
    const auto path = QDir(root).filePath(entry["dir"].toString());
    const auto info = QFileInfo(path);
    if (root.isEmpty() || info.isSymLink() ||
        (!info.canonicalFilePath().isEmpty() && !info.canonicalFilePath().startsWith(root + '/'))) {
        emit failed("模型目录不安全，已取消删除");
        return;
    }
    m_id = id;
    m_active = true;
    m_phase = "deleting";
    m_error.clear();
    emit changed();
    QTimer::singleShot(50, this, [this, path] {
        if (!QDir(path).removeRecursively()) {
            m_phase = "error";
            m_error = "删除失败，请先卸载正在使用的模型";
        } else
            m_phase = "done";
        m_active = false;
        emit changed();
        emit completed(m_id);
        QTimer::singleShot(0, this, &ModelManager::startNext);
    });
}
