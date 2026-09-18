#include "SessionDebug.h"
#include <QCryptographicHash>
#include <QDataStream>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QSaveFile>
#include <QUrl>
#include <QUuid>
#include <QtEndian>
#include <bit>

class DebugWriter : public QObject {
  public:
    std::function<void(QString)> report;
    QString root, path;
    QFile wav, events;
    QJsonObject metadata;
    QCryptographicHash audioHash{QCryptographicHash::Sha256};
    qint64 frames = 0, checkpoint = 0;
    int rate = 0;
    bool broken = false;

    void error(const QString &detail) {
        if (broken) return;
        broken = true;
        metadata["debugError"] = detail;
        report("调试记录保存失败：" + detail);
    }
    void saveMetadata() {
        QSaveFile file(QDir(path).filePath("session.json"));
        const auto bytes = QJsonDocument(metadata).toJson();
        if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
            error(file.errorString());
    }
    QByteArray header() const {
        QByteArray bytes;
        QDataStream out(&bytes, QIODevice::WriteOnly);
        out.setByteOrder(QDataStream::LittleEndian);
        out.writeRawData("RIFF", 4); out << quint32(48 + frames * 4);
        out.writeRawData("WAVEfmt ", 8); out << quint32(16) << quint16(3) << quint16(1);
        out << quint32(rate ? rate : 16000) << quint32((rate ? rate : 16000) * 4) << quint16(4) << quint16(32);
        out.writeRawData("fact", 4); out << quint32(4) << quint32(frames);
        out.writeRawData("data", 4); out << quint32(frames * 4);
        return bytes;
    }
    void updateHeader() {
        if (!wav.isOpen()) return;
        const auto bytes = header();
        if (!wav.seek(0) || wav.write(bytes) != bytes.size() || !wav.seek(56 + frames * 4) || !wav.flush())
            error(wav.errorString());
    }
    void begin(const QString &directory, QJsonObject data, const QString &dictionary) {
        path = directory; metadata = data; broken = false; frames = checkpoint = 0; rate = 0;
        audioHash.reset();
        if (!QDir().mkpath(path)) { error("无法创建 " + path); return; }
        // Content-addressed dictionary snapshots are shared by recordings, not
        // copied into each session. They remain usable after dictionary updates.
        QFile source(dictionary);
        if (source.open(QIODevice::ReadOnly)) {
            const auto bytes = source.readAll();
            const auto hash = QCryptographicHash::hash(bytes, QCryptographicHash::Sha256).toHex();
            const QString relative = "../assets/dictionary-" + QString::fromLatin1(hash) + ".json";
            QDir().mkpath(QDir(root).filePath("assets"));
            const QString target = QDir(path).filePath(relative);
            if (!QFile::exists(target)) {
                QSaveFile copy(target);
                if (!copy.open(QIODevice::WriteOnly) || copy.write(bytes) != bytes.size() || !copy.commit())
                    error(copy.errorString());
            }
            metadata["dictionary"] = QJsonObject{{"path", relative}, {"sha256", QString::fromLatin1(hash)}};
        } else if (!dictionary.isEmpty()) {
            metadata["dictionaryError"] = source.errorString();
        }
        metadata["status"] = "recording";
        metadata["audio"] = QJsonObject{{"path", "audio.wav"}, {"encoding", "float32le"}, {"channels", 1}};
        wav.setFileName(QDir(path).filePath("audio.wav"));
        events.setFileName(QDir(path).filePath("events.jsonl"));
        if (!wav.open(QIODevice::WriteOnly) || !events.open(QIODevice::WriteOnly)) {
            error("无法打开录音或事件文件"); saveMetadata(); return;
        }
        updateHeader(); saveMetadata();
    }
    void record(const QByteArray &bytes) {
        if (broken) return;
        if (events.write(bytes) != bytes.size() || !events.flush()) error(events.errorString());
    }
    void audio(const QVector<float> &samples, int sampleRate) {
        if (broken || samples.isEmpty()) return;
        if (sampleRate <= 0 || (rate && rate != sampleRate)) { error("录音采样率发生变化"); return; }
        if ((frames + samples.size()) * 4 > 0xffffffffLL - 48) { error("单次调试录音超过 WAV 大小限制"); return; }
        rate = sampleRate;
        QByteArray bytes(samples.size() * 4, Qt::Uninitialized);
        for (qsizetype i = 0; i < samples.size(); ++i)
            qToLittleEndian(std::bit_cast<quint32>(samples[i]), bytes.data() + i * 4);
        const auto written = wav.write(bytes);
        if (written > 0) {
            frames += written / 4;
            audioHash.addData(QByteArrayView(bytes).first(written - written % 4));
        }
        if (written != bytes.size()) { error(wav.errorString()); return; }
        if (frames - checkpoint >= rate) { updateHeader(); checkpoint = frames; }
    }
    void finish(const QString &status, const QJsonObject &summary) {
        if (path.isEmpty()) return;
        updateHeader(); wav.close(); events.close();
        metadata["status"] = broken ? "debug_error" : status;
        metadata["endedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
        metadata["summary"] = summary;
        metadata["audio"] = QJsonObject{{"path", "audio.wav"}, {"encoding", "float32le"}, {"channels", 1},
            {"sampleRate", rate}, {"samples", frames}, {"durationMs", rate ? frames * 1000. / rate : 0},
            {"sha256", QString::fromLatin1(audioHash.result().toHex())}};
        saveMetadata(); path.clear();
    }
};

SessionDebug::SessionDebug(QString root, QObject *parent) : QObject(parent), m_root(std::move(root)), m_writer(new DebugWriter) {
    m_writer->root = m_root;
    m_writer->report = [this](const QString &message) {
        QMetaObject::invokeMethod(this, [this, message] { emit failed(message); }, Qt::QueuedConnection);
    };
    m_writer->moveToThread(&m_thread);
    connect(&m_thread, &QThread::finished, m_writer, &QObject::deleteLater);
    m_thread.start();
}
SessionDebug::~SessionDebug() {
    finish("interrupted");
    // Drain queued writes before stopping; no process exit may leave a normal
    // recording with an empty WAV header or a missing terminal event.
    QMetaObject::invokeMethod(m_writer, [] {}, Qt::BlockingQueuedConnection);
    m_thread.quit(); m_thread.wait();
}
void SessionDebug::post(std::function<void(DebugWriter &)> task, qint64 bytes) {
    m_pending += bytes;
    QMetaObject::invokeMethod(m_writer, [this, task = std::move(task), bytes] {
        task(*m_writer); m_pending -= bytes;
    }, Qt::QueuedConnection);
}
QJsonObject SessionDebug::safeSettings(QJsonObject settings) {
    settings.remove("llmApiKey");
    QUrl url(settings["llmBaseUrl"].toString());
    url.setUserInfo(QString()); url.setQuery(QString()); url.setFragment(QString());
    settings["llmBaseUrl"] = url.toString();
    return settings;
}
void SessionDebug::begin(QJsonObject metadata, const QString &dictionary) {
    finish("interrupted");
    m_path = QDir(m_root).filePath(QDateTime::currentDateTimeUtc().toString("yyyyMMdd-HHmmss-zzz") + "-" +
                                  QUuid::createUuid().toString(QUuid::Id128).left(8));
    m_clock.start(); m_sequence = 0; m_active = true;
    metadata["schemaVersion"] = 1;
    metadata["startedAt"] = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
    metadata["settings"] = safeSettings(metadata["settings"].toObject());
    post([path = m_path, metadata, dictionary](DebugWriter &w) { w.begin(path, metadata, dictionary); });
    record("session.start");
}
void SessionDebug::record(const QString &stage, QJsonObject fields) {
    if (!m_active) return;
    if (m_pending > 32 * 1024 * 1024) {
        finish("debug_overflow", {{"error", "调试写入积压超过 32 MB"}});
        emit failed("调试写入过慢，本次记录已停止；语音识别继续运行");
        return;
    }
    fields["stage"] = stage; fields["seq"] = ++m_sequence; fields["elapsedMs"] = m_clock.elapsed();
    const auto bytes = QJsonDocument(fields).toJson(QJsonDocument::Compact) + '\n';
    post([bytes](DebugWriter &w) { w.record(bytes); }, bytes.size());
}
void SessionDebug::audio(const QVector<float> &samples, int rate) {
    if (!m_active) return;
    record("capture.packet", {{"samples", samples.size()}, {"sampleRate", rate}});
    if (m_active) post([samples, rate](DebugWriter &w) { w.audio(samples, rate); }, samples.size() * 4);
}
void SessionDebug::finish(const QString &status, QJsonObject summary) {
    if (!m_active) return;
    // Do not call record(): an overflow must also be able to close its files.
    const auto bytes = QJsonDocument(QJsonObject{{"stage", "session.end"}, {"seq", ++m_sequence},
        {"elapsedMs", m_clock.elapsed()}, {"status", status}, {"summary", summary}}).toJson(QJsonDocument::Compact) + '\n';
    m_active = false;
    post([bytes, status, summary](DebugWriter &w) { w.record(bytes); w.finish(status, summary); });
}
