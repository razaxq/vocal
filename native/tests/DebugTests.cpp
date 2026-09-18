#include "SessionDebug.h"
#include "Settings.h"
#include <QFile>
#include <QDir>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtEndian>
#include <QtTest>
#include <bit>

static QByteArray read(const QString &path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    return file.readAll();
}
class DebugTests : public QObject {
    Q_OBJECT
  private slots:
    void disabledByDefaultAndNoIdleFiles() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        QVERIFY(!settings.values()["debugRecording"].toBool());
        {
            SessionDebug debug(dir.filePath("debug"));
            debug.audio({.1f, .2f}, 16000);
            debug.record("ignored");
            debug.finish("completed");
        }
        QVERIFY(!QDir(dir.filePath("debug")).exists());
    }
    void exactAudioAndIndependentSessions() {
        QTemporaryDir dir;
        QString first, second;
        const QVector<float> samples{0, -.01234567f, .12345678f, 1.f, -1.f};
        {
            SessionDebug debug(dir.filePath("debug"));
            debug.begin({{"settings", QJsonObject{{"llmApiKey", "SECRET"},
                {"llmBaseUrl", "https://name:PASSWORD@example.com/v1?key=SECRET#SECRET"}}}}, {});
            first = debug.path();
            debug.audio(samples.first(2), 16000);
            debug.record("model.output", {{"text", "天气很好"}});
            debug.audio(samples.mid(2), 16000);
            debug.finish("completed", {{"text", "天气很好"}});
            debug.begin({}, {});
            second = debug.path();
            debug.audio({.25f}, 16000);
            debug.finish("cancelled");
        }
        QVERIFY(first != second);
        const auto wav = read(first + "/audio.wav");
        QCOMPARE(wav.size(), 56 + samples.size() * 4);
        QCOMPARE(wav.first(4), "RIFF");
        QCOMPARE(qFromLittleEndian<quint16>(wav.data() + 20), 3);
        QCOMPARE(qFromLittleEndian<quint32>(wav.data() + 24), 16000);
        QCOMPARE(qFromLittleEndian<quint32>(wav.data() + 52), samples.size() * 4);
        for (int i = 0; i < samples.size(); ++i)
            QCOMPARE(qFromLittleEndian<quint32>(wav.data() + 56 + i * 4), std::bit_cast<quint32>(samples[i]));
        const auto metadata = read(first + "/session.json");
        QVERIFY(!metadata.contains("SECRET"));
        QVERIFY(!metadata.contains("PASSWORD"));
        QCOMPARE(QJsonDocument::fromJson(metadata).object()["status"], "completed");
        const auto events = read(first + "/events.jsonl").split('\n');
        qint64 previous = 0;
        for (const auto &line : events) if (!line.isEmpty()) {
            const auto event = QJsonDocument::fromJson(line).object();
            QCOMPARE(event["seq"].toInteger(), ++previous);
        }
        QCOMPARE(read(second + "/audio.wav").size(), 60);
        QCOMPARE(QJsonDocument::fromJson(read(second + "/session.json")).object()["status"], "cancelled");
        QVERIFY(!read(second + "/events.jsonl").contains("天气"));
    }
    void failureIsReportedWithoutAbortingRecognition() {
        QTemporaryDir dir;
        QFile blocker(dir.filePath("debug"));
        QVERIFY(blocker.open(QIODevice::WriteOnly)); blocker.close();
        SessionDebug debug(blocker.fileName());
        QSignalSpy errors(&debug, &SessionDebug::failed);
        debug.begin({}, {});
        debug.audio({.25f}, 16000);
        QTRY_COMPARE(errors.size(), 1);
        debug.finish("error");
    }
    void exitFinalizesPartialRecording() {
        QTemporaryDir dir;
        QString path;
        {
            SessionDebug debug(dir.filePath("debug"));
            debug.begin({}, {}); path = debug.path();
            debug.audio({.5f}, 16000);
        }
        QCOMPARE(QJsonDocument::fromJson(read(path + "/session.json")).object()["status"], "interrupted");
        QCOMPARE(read(path + "/audio.wav").size(), 60);
    }
};
QTEST_GUILESS_MAIN(DebugTests)
#include "DebugTests.moc"
