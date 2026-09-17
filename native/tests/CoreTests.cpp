#include "AudioCapture.h"
#include "ModelCatalog.h"
#include "Platform.h"
#include "Settings.h"
#include "TriggerController.h"
#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#include <cstring>
#include <limits>

class FakePlatform : public Platform {
  public:
    bool full = false;
    bool start(QString *) override { return true; }
    bool fullscreen() const override { return full; }
    quintptr target() const override { return 1; }
    bool inject(quintptr, const QString &, QString *) override { return true; }
    bool inputSupported() const override { return true; }
};
class CoreTests : public QObject {
    Q_OBJECT
  private slots:
    void pcmChunkBoundaries() {
        QAudioFormat format;
        format.setSampleRate(48000);
        format.setChannelCount(2);
        format.setSampleFormat(QAudioFormat::Int16);
        PcmDecoder decoder(format);
        const qint16 samples[]{16384, 0, -32768, 0, 32767, 32767};
        const QByteArray bytes(reinterpret_cast<const char *>(samples), sizeof(samples));
        QVERIFY(decoder.append(bytes.first(3)).isEmpty());
        QCOMPARE(decoder.append(bytes.mid(3, 3)), QVector<float>{.25f});
        const auto last = decoder.append(bytes.mid(6));
        QCOMPARE(last.size(), 2);
        QCOMPARE(last[0], -.5f);
        QVERIFY(qAbs(last[1] - 32767.f / 32768) < .00001f);
    }
    void floatSanitization() {
        QAudioFormat format;
        format.setSampleRate(16000);
        format.setChannelCount(1);
        format.setSampleFormat(QAudioFormat::Float);
        PcmDecoder decoder(format);
        const float samples[]{std::numeric_limits<float>::quiet_NaN(), 2, -.25f};
        QCOMPARE(decoder.append(QByteArray(reinterpret_cast<const char *>(samples), sizeof(samples))),
                 (QVector<float>{0, 1, -.25f}));
    }
    void silenceGateAtDeviceRates() {
        for (int rate : {16000, 44100, 48000}) {
            QVERIFY(!hasVoice(QVector<float>(rate, 0), rate));
            QVERIFY(!hasVoice(QVector<float>(rate / 10, .1f), rate));
            QVERIFY(hasVoice(QVector<float>(rate, .015f), rate));
            QVector<float> shortSpeech(rate * 5, 0);
            std::fill(shortSpeech.begin(), shortSpeech.begin() + rate / 2, .015f);
            QVERIFY(hasVoice(shortSpeech, rate));
        }
    }
    void settingsPersistence() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        QCOMPARE(settings.values()["modelId"].toString(), "paraformer-yue-offline");
        QVERIFY(!settings.values()["keyboardInFullscreen"].toBool());
        QVERIFY(settings.set("mouseEnabled", true));
        QVERIFY(settings.set("language", "en"));
        QVERIFY(!settings.set("mouseHoldDelayMs", 0));
        QVERIFY(!settings.set("mouseEnabled", "true"));
        Settings restored(dir.path());
        QVERIFY(restored.values()["mouseEnabled"].toBool());
        QCOMPARE(restored.values()["language"].toString(), "en");
    }
    void corruptSettingsPreserved() {
        QTemporaryDir dir;
        QFile file(dir.filePath("settings.json"));
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write("broken{");
        file.close();
        Settings settings(dir.path());
        QVERIFY(!settings.loadError().isEmpty());
        QVERIFY(!settings.set("mouseEnabled", true));
        QVERIFY(file.open(QIODevice::ReadOnly));
        QCOMPARE(file.readAll(), QByteArray("broken{"));
    }
    void registryMissingFiles() {
        QTemporaryDir dir;
        ModelCatalog catalog(dir.path());
        QCOMPARE(catalog.offlineModels().size(), 5);
        const auto model = catalog.find("paraformer-yue-offline");
        QVERIFY(!model.isEmpty());
        QVERIFY(!catalog.installed(model));
        QVERIFY(!catalog.installed(catalog.find("unknown")));
        QCOMPARE(catalog.file(model, "joiner"), QString{});
    }
    void fullscreenGeometry() {
        const QRect monitor(-1920, 0, 1920, 1080);
        QVERIFY(coversMonitor(monitor, monitor, "Game"));
        QVERIFY(!coversMonitor(QRect(-1920, 30, 1920, 1010), monitor, "App"));
        QVERIFY(!coversMonitor(monitor, monitor, "WorkerW"));
        QVERIFY(!coversMonitor(QRect(), monitor, "App"));
    }
    void keyboardFullscreenLifecycle() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        FakePlatform platform;
        TriggerController trigger(&platform);
        trigger.configure(settings.values());
        QSignalSpy pressed(&trigger, &TriggerController::pressed), released(&trigger, &TriggerController::released);
        platform.full = true;
        trigger.accept(0, true);
        QCOMPARE(pressed.size(), 0);
        platform.full = false;
        trigger.accept(0, true);
        QCOMPARE(pressed.size(), 0); // no auto-repeat start
        trigger.accept(0, false);
        trigger.accept(0, true);
        QTRY_COMPARE(pressed.size(), 1);
        platform.full = true;
        trigger.accept(0, false);
        QCOMPARE(released.size(), 1);
    }
    void mouseDelayAndRelease() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        settings.set("mouseEnabled", true);
        settings.set("mouseHoldDelayMs", 100);
        settings.set("mouseButton", "leftMiddle");
        FakePlatform platform;
        TriggerController trigger(&platform);
        trigger.configure(settings.values());
        QSignalSpy pressed(&trigger, &TriggerController::pressed), released(&trigger, &TriggerController::released);
        trigger.accept(1, true);
        QTest::qWait(130);
        QCOMPARE(pressed.size(), 0);
        trigger.accept(2, true);
        platform.full = true;
        QTest::qWait(140);
        QCOMPARE(pressed.size(), 0);
        platform.full = false;
        QTest::qWait(120);
        QCOMPARE(pressed.size(), 0);
        trigger.accept(2, false);
        trigger.accept(2, true);
        QTRY_COMPARE(pressed.size(), 1);
        trigger.accept(1, false);
        QCOMPARE(released.size(), 1);
    }
    void keyboardPressDebounce_data() {
        QTest::addColumn<QString>("mode");
        for (const auto &mode : {"hold", "toggle", "doubleTap"})
            QTest::newRow(mode) << QString(mode);
    }
    void keyboardPressDebounce() {
        QFETCH(QString, mode);
        QTemporaryDir dir;
        Settings settings(dir.path());
        settings.set("keyboardMode", mode);
        settings.set("debounceMs", 0);
        FakePlatform platform;
        TriggerController trigger(&platform);
        trigger.configure(settings.values());
        QSignalSpy pressed(&trigger, &TriggerController::pressed), released(&trigger, &TriggerController::released);
        trigger.accept(0, true);
        // Release before dispatching the debounce timer. qWait(2) may run
        // longer than 10 ms on a busy runner and accidentally accept the press.
        trigger.accept(0, false);
        QTest::qWait(20);
        QCOMPARE(pressed.size(), 0);
        QCOMPARE(released.size(), 0);
        trigger.accept(0, true);
        QCOMPARE(pressed.size(), 0);
        trigger.accept(0, true); // auto-repeat must not duplicate a press
        if (mode == "doubleTap") {
            QTest::qWait(50);
            QCOMPARE(pressed.size(), 0); // the short tap did not count as the first tap
            trigger.accept(0, false);
            trigger.accept(0, true);
        }
        QTRY_COMPARE(pressed.size(), 1);
        trigger.accept(0, false);
        if (mode != "hold") {
            trigger.accept(0, true);
            trigger.accept(0, false);
            QTest::qWait(20);
            QCOMPARE(released.size(), 0); // bounce must not stop a latched recording
            trigger.accept(0, true);
            QTRY_COMPARE(released.size(), 1);
            trigger.accept(0, false);
        }
        QCOMPARE(released.size(), 1);
    }
    void pendingKeyboardPressCancellation() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        FakePlatform platform;
        TriggerController trigger(&platform);
        trigger.configure(settings.values());
        QSignalSpy pressed(&trigger, &TriggerController::pressed);
        for (int reason = 0; reason < 3; ++reason) {
            platform.full = false;
            trigger.accept(0, true);
            if (reason == 0)
                trigger.configure(settings.values());
            else if (reason == 1)
                emit platform.escapePressed();
            else
                platform.full = true;
            QTest::qWait(25);
            QCOMPARE(pressed.size(), 0);
            trigger.accept(0, false);
        }
    }
};
QTEST_MAIN(CoreTests)
#include "CoreTests.moc"
