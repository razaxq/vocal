#include "AudioCapture.h"
#include "Platform.h"
#include <QApplication>
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
    if (args.contains("--capture")) {
        AudioCapture audio;
        QString error;
        if (!audio.start({}, &error)) {
            report({{"error", error}});
            return 1;
        }
        double peak = 0;
        QObject::connect(&audio, &AudioCapture::levelChanged, &app, [&](double value) { peak = qMax(peak, value); });
        QObject::connect(&audio, &AudioCapture::failed, &app, [&](const QString &message) {
            report({{"error", message}});
            app.exit(2);
        });
        QTimer::singleShot(3000, &app, [&] {
            const auto samples = audio.stop();
            report({{"sampleRate", audio.sampleRate()}, {"samples", samples.size()}, {"peakMeter", peak}});
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
