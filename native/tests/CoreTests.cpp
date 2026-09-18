#include "AudioCapture.h"
#include "AudioSegmenter.h"
#include "ModelCatalog.h"
#include "NativeRelease.h"
#include "Platform.h"
#include "Settings.h"
#include "TriggerController.h"
#include "TextCleanup.h"
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
    void startupUpdateGate() {
        StartupUpdateGate updating;
        for (const auto &state : {"idle", "checking", "available", "downloading", "installing"}) {
            QVERIFY(!updating.finishIfReady(state, true));
            QVERIFY(updating.pending());
        }
        QVERIFY(updating.finishIfReady("error", true)); // Download/install failure resumes ASR.
        QVERIFY(!updating.pending());
        QVERIFY(!updating.finishIfReady("checking", true)); // Later checks never gate again.
        for (const auto &state : {"current", "error", "development"}) {
            StartupUpdateGate startup;
            QVERIFY(startup.finishIfReady(state, true));
            QVERIFY(!startup.pending());
        }
        StartupUpdateGate manual;
        QVERIFY(manual.finishIfReady("available", false));
        StartupUpdateGate diagnostic(false);
        QVERIFY(!diagnostic.pending());
    }
    void settingErrorsIdentifyFieldAndRange() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        QString error;
        for (const QJsonValue value : {QJsonValue(99999), QJsonValue(1.5), QJsonValue("abc")}) {
            QVERIFY(!settings.set("mouseHoldDelayMs", value, &error));
            QVERIFY(error.contains("按住多久开始"));
            QVERIFY(error.contains("100–10000 ms"));
            QCOMPARE(settings.values()["mouseHoldDelayMs"].toInt(), 1000);
        }
        QVERIFY(settings.set("language", "en"));
        QVERIFY(!settings.set("idleUnloadMin", -1, &error));
        QVERIFY(error.contains("Unload when idle"));
        QVERIFY(error.contains("0 to 240 min"));
        QVERIFY(settings.set("idleUnloadMin", 20));
        QCOMPARE(Settings(dir.path()).values()["idleUnloadMin"].toInt(), 20);
    }
    void migratesAiOffWithoutEnablingCloudRequests() {
        QTemporaryDir dir;
        QFile file(dir.filePath("settings.json"));
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write(QJsonDocument(QJsonObject{{"llmEnabled", true}, {"consolidationMode", "off"},
                                            {"llmModel", "saved-model"}}).toJson());
        file.close();
        Settings settings(dir.path());
        QVERIFY(!settings.values()["llmEnabled"].toBool());
        QCOMPARE(settings.values()["consolidationMode"], "onFinish");
        QCOMPARE(settings.values()["llmModel"], "saved-model");
        QVERIFY(settings.set("llmEnabled", true));
        Settings restored(dir.path());
        QVERIFY(restored.values()["llmEnabled"].toBool());
        QCOMPARE(restored.values()["consolidationMode"], "onFinish");
    }
    void migratesOverlayAndOutputTiming() {
        for (const auto &timing : {"segment", "live"}) {
            QTemporaryDir dir;
            QFile file(dir.filePath("settings.json"));
            QVERIFY(file.open(QIODevice::WriteOnly));
            file.write(QJsonDocument(QJsonObject{{"injectMode", timing}, {"overlayShowText", false}}).toJson());
            file.close();
            Settings migrated(dir.path());
            QCOMPARE(migrated.values()["injectMode"].toString(), "preview");
            QCOMPARE(migrated.values()["overlayTextMode"].toString(), "none");
            QVERIFY(migrated.set("overlayTextMode", "all"));
            Settings restored(dir.path());
            QCOMPARE(restored.values()["overlayTextMode"].toString(), "all");
        }
    }
    void joinUnpunctuatedFragments() {
        QCOMPARE(joinSpeechFragments("Hello", "world"), "Hello world");
        QCOMPARE(joinSpeechFragments("Hello ", "world"), "Hello world");
        QCOMPARE(joinSpeechFragments("因为现在已经", "五点了"), "因为现在已经五点了");
        QCOMPARE(joinSpeechFragments("123", "456"), "123456");
        QCOMPARE(joinSpeechFragments("", "hello"), "hello");
    }
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
    void gapSplitsPreserveEverySample() {
        for (int rate : {16000, 44100, 48000}) {
            QVector<float> audio(rate, .025f);
            audio.append(QVector<float>(rate * 3 / 2, 0));
            audio.append(QVector<float>(rate, -.035f));
            audio.append(QVector<float>(rate * 3 / 2, 0));
            audio.append(QVector<float>(rate / 2 + 13, .045f));
            for (qsizetype packet : {qsizetype(137), qsizetype(rate / 10), audio.size()}) {
                AudioSegmenter segmenter;
                QList<QVector<float>> segments;
                for (qsizetype at = 0; at < audio.size(); at += packet)
                    segments.append(segmenter.append(audio.mid(at, packet), rate, 1500));
                segments.append(segmenter.finish());
                QCOMPARE(segments.size(), 3);
                // Cuts lie inside silence, with padding on both sides. A packet
                // containing the next word must never donate that word to the
                // previous inference job, regardless of packet/frame alignment.
                qsizetype boundary = 0;
                QVector<float> joined;
                for (int i = 0; i < segments.size(); ++i) {
                    joined.append(segments[i]);
                    boundary += segments[i].size();
                    if (i < 2) {
                        const qsizetype speechEnd = i == 0 ? rate : rate * 7 / 2;
                        QVERIFY(boundary >= speechEnd + rate / 5);
                        QVERIFY(boundary <= speechEnd + rate * 13 / 10);
                        QCOMPARE(audio[boundary], 0.f);
                    }
                }
                QCOMPARE(joined, audio); // No dropped/duplicated onset or tail.
            }
        }
    }
    void shortPauseAndContinuousSpeechStayBuffered() {
        AudioSegmenter segmenter;
        QVector<float> audio(16000, .02f);
        audio.append(QVector<float>(16000 * 1460 / 1000, 0));
        audio.append(QVector<float>(16000, .03f));
        QVERIFY(segmenter.append(audio, 16000, 1500).isEmpty());
        QCOMPARE(segmenter.finish(), audio);
        // The old 30 s timeout cut through an ongoing word.
        const QVector<float> continuous(16000 * 31, .02f);
        QVERIFY(segmenter.append(continuous, 16000, 1500).isEmpty());
        QCOMPARE(segmenter.finish(), continuous);
    }
    void silentCacheAndRecordingLimitAreBounded() {
        AudioSegmenter segmenter;
        for (int i = 0; i < 180; ++i) {
            for (const auto &part : segmenter.append(QVector<float>(16000, 0), 16000, 1500))
                QVERIFY(!hasVoice(part, 16000));
            QVERIFY(segmenter.pending().size() < 16000 * 2);
        }
        segmenter.reset();
        for (int i = 0; i < 120; ++i)
            QVERIFY(segmenter.append(QVector<float>(16000, .02f), 16000, 1500).isEmpty());
        QVERIFY(segmenter.atLimit());
        QCOMPARE(segmenter.finish().size(), 16000 * 120);
        QVERIFY(!segmenter.atLimit());
        QVERIFY(segmenter.pending().isEmpty());
    }
    void settingsPersistence() {
        QTemporaryDir dir;
        Settings settings(dir.path());
        QCOMPARE(settings.values()["modelId"].toString(), "paraformer-yue-offline");
        QVERIFY(settings.values()["automaticSegmentation"].toBool());
        QVERIFY(settings.values()["microphoneWarmup"].toBool());
        QVERIFY(settings.set("microphoneWarmup", false));
        QVERIFY(settings.set("automaticSegmentation", false));
        QCOMPARE(settings.values()["overlayTextMode"].toString(), "latest");
        QCOMPARE(settings.values()["injectMode"].toString(), "final");
        QVERIFY(settings.set("overlayTextMode", "none"));
        QVERIFY(settings.set("injectMode", "preview"));
        QVERIFY(!settings.set("overlayTextMode", "invalid"));
        QVERIFY(!settings.set("injectMode", "live"));
        QVERIFY(!settings.values()["keyboardInFullscreen"].toBool());
        QVERIFY(settings.set("mouseEnabled", true));
        QVERIFY(settings.set("language", "en"));
        QVERIFY(!settings.set("mouseHoldDelayMs", 0));
        QVERIFY(!settings.set("mouseEnabled", "true"));
        Settings restored(dir.path());
        QVERIFY(!restored.values()["automaticSegmentation"].toBool());
        QVERIFY(!restored.values()["microphoneWarmup"].toBool());
        QCOMPARE(restored.values()["overlayTextMode"].toString(), "none");
        QCOMPARE(restored.values()["injectMode"].toString(), "preview");
        QVERIFY(restored.values()["mouseEnabled"].toBool());
        QCOMPARE(restored.values()["language"].toString(), "en");
    }
    void automaticPhrasePausesPreserveOnsets() {
        for (int rate : {16000, 44100, 48000}) {
            QVector<float> audio(rate * 2, .025f);
            audio.append(QVector<float>(rate * 320 / 1000, 0));
            audio.append(QVector<float>(rate / 20, .003f)); // Soft onset of the next word.
            audio.append(QVector<float>(rate, -.035f));
            for (qsizetype packet : {qsizetype(137), qsizetype(rate / 10), audio.size()}) {
                AudioSegmenter segmenter;
                QList<QVector<float>> pieces;
                for (qsizetype at = 0; at < audio.size(); at += packet)
                    pieces.append(segmenter.append(audio.mid(at, packet), rate, 5000, true));
                pieces.append(segmenter.finish());
                QCOMPARE(pieces.size(), 2); // Does not wait for the manual 5 s value.
                QVERIFY(pieces.first().size() > rate * 2);
                QVERIFY(pieces.first().size() < rate * 2320 / 1000);
                QCOMPARE(pieces.first() + pieces.last(), audio);
            }
        }
    }
    void automaticSegmentationFollowsWordGapRhythm() {
        AudioSegmenter fast, slow;
        QVERIFY(fast.append(QVector<float>(32000, .025f), 16000, 1500, true).isEmpty());
        QCOMPARE(fast.append(QVector<float>(5120, 0), 16000, 1500, true).size(), 1);
        // Longer within-phrase word gaps raise the boundary threshold. The
        // same 320 ms pause should not split this slower speaking rhythm.
        for (int i = 0; i < 4; ++i) {
            QVERIFY(slow.append(QVector<float>(6400, .025f), 16000, 1500, true).isEmpty());
            if (i < 3)
                QVERIFY(slow.append(QVector<float>(3520, 0), 16000, 1500, true).isEmpty());
        }
        QVERIFY(slow.append(QVector<float>(5120, 0), 16000, 1500, true).isEmpty());
        QCOMPARE(slow.append(QVector<float>(3200, 0), 16000, 1500, true).size(), 1);
    }
    void automaticSegmentationRejectsBriefDipsAndTinyFragments() {
        AudioSegmenter segmenter;
        QVector<float> audio(32000, .025f);
        audio.append(QVector<float>(3200, 0)); // 200 ms, then speech resumes.
        audio.append(QVector<float>(16000, .025f));
        QVERIFY(segmenter.append(audio, 16000, 1500, true).isEmpty());
        QCOMPARE(segmenter.finish(), audio);
        QVERIFY(segmenter.append(QVector<float>(3200, .025f), 16000, 1500, true).isEmpty());
        QVERIFY(segmenter.append(QVector<float>(9600, 0), 16000, 1500, true).isEmpty());
        QCOMPARE(segmenter.append(QVector<float>(1600, 0), 16000, 1500, true).size(), 1);
    }
    void automaticSegmentationKeepsStartupTransientWithSpeech() {
        AudioSegmenter segmenter;
        QVector<float> audio(640, .025f); // 40 ms device-start transient.
        audio.append(QVector<float>(10560, 0)); // 660 ms before real speech.
        audio.append(QVector<float>(32000, .025f));
        QVERIFY(segmenter.append(audio, 16000, 1500, true).isEmpty());
        QCOMPARE(segmenter.finish(), audio);
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
