#include "AudioCapture.h"
#include "AsyncAudioCapture.h"
#include "Platform.h"
#include "ReplacementProbe.h"
#include <QApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QFontDatabase>
#include <QFontInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLineEdit>
#include <QProcess>
#include <QRawFont>
#include <QTest>
#include <QTimer>
#include <iostream>
#include <windows.h>

static void report(const QJsonObject &data) {
    std::cout << QJsonDocument(data).toJson(QJsonDocument::Compact).constData() << std::endl;
}
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    const auto args = app.arguments();
    if (args.contains("--replacement-fixture"))
        return ReplacementProbe::fixture(app, args.value(args.indexOf("--replacement-fixture") + 1) == "native",
                                          args.contains("--replacement-moved"));
    if (args.contains("--replace"))
        return ReplacementProbe::run(app, args.value(args.indexOf("--replace") + 1, "native"),
                                      args.contains("--replacement-moved"));
    if (args.contains("--hooks")) {
        for (int i = 0; i < 3; ++i) {
            auto platform = createPlatform();
            QString error;
            if (!platform->start(&error)) {
                report({{"error", error}});
                return 5;
            }
            const auto threadId = platform->property("nativeHookThreadId").toUInt();
            HANDLE thread = OpenThread(SYNCHRONIZE, FALSE, threadId);
            const bool dedicated = thread && threadId != GetCurrentThreadId();
            platform.reset();
            const bool joined = thread && WaitForSingleObject(thread, 0) == WAIT_OBJECT_0;
            if (thread)
                CloseHandle(thread);
            report({{"dedicatedHookThread", dedicated}, {"threadStoppedOnExit", joined}});
            if (!dedicated || !joined)
                return 6;
        }
        return 0;
    }
    if (args.contains("--font-info")) {
        for (const QString &name :
             {QString("Microsoft YaHei UI"), QString("Microsoft YaHei"), QString("Segoe UI Variable Text")}) {
            QFont font(name);
            font.setPixelSize(13);
            const auto raw = QRawFont::fromFont(font);
            report({{"requested", name},
                    {"matched", QFontInfo(font).family()},
                    {"raw", raw.familyName()},
                    {"han", raw.supportsCharacter(0x4e2d)}});
        }
        return 0;
    }
    if (args.contains("--fixture")) {
        QLineEdit field;
        field.setWindowTitle("Vocal native input test (temporary)");
        field.resize(560, 80);
        field.show();
        field.activateWindow();
        field.setFocus();
        QTimer::singleShot(200, &app, [&] { report({{"window", QString::number(quintptr(field.winId()))}}); });
        QTimer::singleShot(1200, &app, [&] {
            report({{"text", field.text()}, {"focused", field.hasFocus()}, {"active", field.isActiveWindow()}});
        });
        QObject::connect(&field, &QLineEdit::textChanged, &app, [&](const QString &text) { report({{"text", text}}); });
        QTimer::singleShot(10000, &app, &QApplication::quit);
        return app.exec();
    }
    if (args.contains("--capture-warm") || args.contains("--capture-cold")) {
        const bool warm = args.contains("--capture-warm");
        const bool shortProbe = args.contains("--capture-short");
        const int delayIndex = args.indexOf("--trigger-delay");
        const int triggerDelay = delayIndex >= 0 && delayIndex + 1 < args.size()
                                     ? qBound(0, args[delayIndex + 1].toInt(), 5000) : 2000;
        const auto device = QMediaDevices::defaultAudioInput();
        AsyncAudioCapture audio;
        QElapsedTimer sinceTrigger;
        double firstFrameMs = -1, first150msAudioAtMs = -1;
        qint64 samples = 0;
        int heartbeats = 0;
        QTimer heartbeat;
        heartbeat.setInterval(10);
        QObject::connect(&heartbeat, &QTimer::timeout, &app, [&] { ++heartbeats; });
        heartbeat.start();
        QObject::connect(&audio, &AsyncAudioCapture::frames, &app, [&](const QVector<float> &pcm, int rate) {
            if (pcm.isEmpty()) return;
            samples += pcm.size();
            if (first150msAudioAtMs < 0 && samples >= rate * .15)
                first150msAudioAtMs = sinceTrigger.nsecsElapsed() / 1.e6;
            if (firstFrameMs >= 0) return;
            firstFrameMs = sinceTrigger.nsecsElapsed() / 1.e6;
            QTimer::singleShot(shortProbe ? 300 : 3000, &audio, &AsyncAudioCapture::stop);
        });
        QObject::connect(&audio, &AsyncAudioCapture::failed, &app, [&](const QString &error) {
            report({{"error", error}, {"guiHeartbeats", heartbeats}});
            audio.setWarmup(false, {});
            app.exit(2);
        });
        QObject::connect(&audio, &AsyncAudioCapture::stopped, &app, [&] {
            report({{"sampleRate", audio.sampleRate()}, {"samples", samples},
                    {"firstFrameMs", firstFrameMs}, {"first150msAudioAtMs", first150msAudioAtMs},
                    {"warmup", warm}, {"device", device.description()},
                    {"deviceId", QString::fromLatin1(device.id().toBase64())},
                    {"triggerDelayMs", triggerDelay}, {"guiHeartbeats", heartbeats}});
            audio.setWarmup(false, {});
            app.exit(samples > audio.sampleRate() * (shortProbe ? .15 : 1.) ? 0 : 3);
        });
        report({{"stage", warm ? "warming-device" : "waiting-with-device-closed"}});
        audio.setWarmup(warm, {});
        QTimer::singleShot(triggerDelay, &app, [&] {
            report({{"stage", "trigger"}, {"guiHeartbeats", heartbeats}});
            sinceTrigger.start();
            audio.start({});
        });
        QTimer::singleShot(12000, &app, [&] {
            report({{"error", "probe deadline"}, {"guiHeartbeats", heartbeats}});
            app.exit(4);
        });
        return app.exec(); // No PCM is saved or passed to a recognizer.
    }
    if (args.contains("--capture")) {
        report({{"stage", "constructing-capture"}});
        AudioCapture audio;
        report({{"stage", "opening-device"}});
        QElapsedTimer startup;
        startup.start();
        qint64 firstFrameMs = -1;
        QObject::connect(&audio, &AudioCapture::frames, &app, [&](const QVector<float> &samples, int) {
            if (!samples.isEmpty() && firstFrameMs < 0)
                firstFrameMs = startup.elapsed();
        });
        QString error;
        if (!audio.start({}, &error)) {
            report({{"error", error}, {"openMs", startup.elapsed()}});
            return 1;
        }
        const qint64 openMs = startup.elapsed();
        double peak = 0;
        QObject::connect(&audio, &AudioCapture::levelChanged, &app, [&](double value) { peak = qMax(peak, value); });
        QObject::connect(&audio, &AudioCapture::failed, &app, [&](const QString &message) {
            report({{"error", message}});
            app.exit(2);
        });
        QTimer::singleShot(3000, &app, [&] {
            const auto samples = audio.stop();
            report({{"sampleRate", audio.sampleRate()}, {"samples", samples.size()}, {"peakMeter", peak},
                    {"openMs", openMs}, {"firstFrameMs", firstFrameMs}, {"bufferMs", audio.bufferDurationMs()}});
            // Audio is held in memory only and discarded on exit.
            app.exit(samples.size() > audio.sampleRate() ? 0 : 3);
        });
        return app.exec();
    }
    auto platform = createPlatform();
    QProcess fixture;
    fixture.start(app.applicationFilePath(), {"--fixture"});
    if (!fixture.waitForStarted(3000) || !fixture.waitForReadyRead(5000))
        return 1;
    const auto first = QJsonDocument::fromJson(fixture.readLine()).object();
    const auto window = first["window"].toString().toULongLong();
    if (!window) {
        fixture.kill();
        fixture.waitForFinished();
        return 2;
    }
    const auto fixtureWindow = reinterpret_cast<HWND>(window);
    const DWORD foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
    const DWORD testThread = GetCurrentThreadId();
    const bool attached = foregroundThread != testThread && AttachThreadInput(testThread, foregroundThread, TRUE);
    ShowWindow(fixtureWindow, SW_SHOW);
    SetForegroundWindow(fixtureWindow);
    if (attached)
        AttachThreadInput(testThread, foregroundThread, FALSE);
    for (int i = 0; i < 30 && platform->target() != window; ++i)
        QTest::qWait(50);
    QString error;
    const QString expected = QString::fromUtf8("Vocal 原生输入 English 123 😀");
    if (!platform->inject(window, expected, &error)) {
        DWORD foregroundPid = 0, targetPid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &foregroundPid);
        GetWindowThreadProcessId(fixtureWindow, &targetPid);
        report({{"error", error},
                {"target", QString::number(window)},
                {"foreground", QString::number(platform->target())},
                {"foregroundPid", int(foregroundPid)},
                {"targetPid", int(targetPid)},
                {"fixturePid", fixture.processId()}});
        fixture.kill();
        fixture.waitForFinished();
        return 3;
    }
    QTest::qWait(1500);
    QString actual;
    while (fixture.canReadLine()) {
        const auto row = QJsonDocument::fromJson(fixture.readLine()).object();
        if (row.contains("focused"))
            report(row);
        if (row.contains("text"))
            actual = row["text"].toString();
    }
    // A stale/invalid target must be refused without typing into anything else.
    const bool rejected = !platform->inject(0, "must not type", &error);
    report({{"inputMatches", actual == expected}, {"invalidTargetRejected", rejected}, {"text", actual}});
    fixture.kill();
    fixture.waitForFinished();
    return actual == expected && rejected ? 0 : 4;
}
