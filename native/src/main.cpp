#include "AppController.h"
#include "CorrectionWorker.h"
#include "SpeechWorker.h"
#include "StreamWorker.h"
#include "WindowActivation.h"
#include "WindowChrome.h"
#include "UiDiagnostics.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QJsonDocument>
#include <QLockFile>
#include <QMenu>
#include <QPointer>
#include <QQmlApplicationEngine>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QStandardPaths>
#include <QSystemTrayIcon>

int main(int argc, char *argv[]) {
#ifdef Q_OS_WIN
    if (qEnvironmentVariableIsEmpty("QT_MEDIA_BACKEND"))
        qputenv("QT_MEDIA_BACKEND", "windows");
#endif
    qInstallMessageHandler([](QtMsgType, const QMessageLogContext &, const QString &message) {
        const auto bytes = message.toUtf8();
        fprintf(stderr, "%s\n", bytes.constData());
        fflush(stderr);
    });
    // Keep the ASR child free of GUI plugins and platform hooks.
    for (int i = 1; i < argc; ++i) {
        if (QString::fromLocal8Bit(argv[i]) == "--asr-worker" || QString::fromLocal8Bit(argv[i]) == "--transcribe" ||
            QString::fromLocal8Bit(argv[i]) == "--correction-worker" ||
            QString::fromLocal8Bit(argv[i]) == "--stream-worker") {
            QCoreApplication app(argc, argv);
            if (app.arguments().contains("--stream-worker"))
                return runStreamWorker(app.arguments());
            if (app.arguments().contains("--correction-worker"))
                return runCorrectionWorker(app.arguments());
            return runSpeechWorker(app.arguments());
        }
    }
    QApplication app(argc, argv);
    app.setOrganizationName("Vocal");
    app.setApplicationName("VocalNative");
    app.setApplicationVersion(VOCAL_APP_VERSION);
    app.setWindowIcon(QIcon(":/vocal/resources/icon.png"));
    QFont interfaceFont("Microsoft YaHei UI");
    interfaceFont.setPixelSize(13);
    app.setFont(interfaceFont);
    QQuickStyle::setStyle("Basic");
    QCommandLineParser parser;
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOptions(
        {{"model-dir", "Model directory", "directory"},
         {"data-dir", "Native settings and history directory", "directory"},
         {"no-hooks", "Disable global input hooks"},
         {"autostart", "Start in the tray"},
         {"smoke-page", "Settings page for UI verification", "index", "0"},
         {"smoke-theme", "Theme for UI verification", "theme"},
         {"smoke-overlay", "Capture the compact or full voice overlay", "layout"},
         {"smoke-scroll", "Scroll position for UI verification", "pixels", "0"},
         {"smoke-native-frame", "Capture the OS-composited window including its corners"},
         {"smoke-resource-refresh", "Verify resource rows survive repeated statistics updates"},
         {"smoke-ui-only", "Validate deployment UI without requiring downloaded models"},
         {"smoke-overlay-pipeline", "Verify overlay continuity with a public 16 kHz float PCM fixture", "pcm"},
         {"profile-ui", "Measure settings scrolling and GUI latency", "json"},
         {"profile-wheel", "Use real Qt wheel events for UI profiling"},
         {"pipeline-test", "Run local 16 kHz float PCM through the complete pipeline without input hooks", "pcm"},
         {"pipeline-segments", "Number of test segments", "count", "1"},
         {"smoke-test", "Save a UI screenshot after model startup, then exit", "png"}});
    parser.process(app);
    const auto dataDir = parser.isSet("data-dir") ? parser.value("data-dir")
                                                  : QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dataDir);
    QLockFile lock(QDir(dataDir).filePath("native.lock"));
    if (!lock.tryLock(0)) {
        qCritical("Vocal Native is already using this data directory.");
        return 2;
    }
    auto models = parser.value("model-dir");
    if (models.isEmpty())
        models = QDir(dataDir).filePath("models");
    AppController controller(dataDir, models,
                             !parser.isSet("no-hooks") && !parser.isSet("smoke-test") &&
                                 !parser.isSet("pipeline-test") && !parser.isSet("profile-ui"),
                             !parser.isSet("smoke-test") && !parser.isSet("pipeline-test") &&
                                 !parser.isSet("profile-ui"));
    if (parser.isSet("pipeline-test")) {
        bool started = false, finished = false;
        QObject::connect(&controller, &AppController::changed, &app, [&] {
            if (controller.state() == "ready" && !started) {
                started = true;
                controller.transcribeForTest(parser.value("pipeline-test"), 16000,
                                             parser.value("pipeline-segments").toInt());
                return;
            }
            if (started && !finished && (controller.state() == "ready" || controller.state() == "error")) {
                finished = true;
                const QJsonObject event{{"type", "pipeline-result"},
                                        {"text", controller.result()},
                                        {"error", controller.error()},
                                        {"history", controller.history().size()}};
                printf("%s\n", QJsonDocument(event).toJson(QJsonDocument::Compact).constData());
                fflush(stdout);
                app.exit(controller.state() == "ready" ? 0 : 3);
            }
        });
        QTimer::singleShot(120000, &app, [] { QCoreApplication::exit(4); });
        return app.exec();
    }
    if (parser.isSet("smoke-test") && parser.isSet("smoke-theme"))
        controller.setSetting("theme", parser.value("smoke-theme"));
    QQmlApplicationEngine engine;
    engine.setInitialProperties({{"controller", QVariant::fromValue(&controller)}});
    QObject::connect(
        &engine, &QQmlApplicationEngine::objectCreationFailed, &app, [] { QCoreApplication::exit(1); },
        Qt::QueuedConnection);
    engine.loadFromModule("Vocal", "Main");
    if (engine.rootObjects().isEmpty())
        return 1;
    auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    applyWindowChrome(window);
    QObject::connect(window, &QWindow::visibleChanged, window, [window](bool visible) {
        if (visible)
            applyWindowChrome(window);
    });
    if (parser.isSet("smoke-test") || parser.isSet("profile-ui"))
        window->setProperty("page", parser.value("smoke-page").toInt());
    if (parser.isSet("smoke-resource-refresh"))
        window->setProperty("page", 8);
    if (parser.isSet("autostart"))
        window->hide();
    QSystemTrayIcon tray(app.windowIcon());
    QMenu menu;
    menu.addAction("Vocal Native", window, [window] { restoreMainWindow(window); });
    menu.addSeparator();
    menu.addAction("退出 / Quit", &app, &QApplication::quit);
    tray.setContextMenu(&menu);
    tray.setToolTip("Vocal Native");
    if (QSystemTrayIcon::isSystemTrayAvailable() && !parser.isSet("smoke-test") && !parser.isSet("profile-ui")) {
        window->setProperty("closeToTray", true);
        app.setQuitOnLastWindowClosed(false);
        tray.show();
        connectTrayActivation(&tray, window);
    }
    if (parser.isSet("profile-ui")) {
        const auto output = parser.value("profile-ui");
        const auto wheel = parser.isSet("profile-wheel");
        auto started = std::make_shared<bool>(false);
        QObject::connect(&controller, &AppController::changed, &app, [=, &controller] {
            if (!*started && (controller.state() == "ready" || controller.state() == "error")) {
                *started = true;
                QTimer::singleShot(1000, window, [=] { profileSettingsWindow(window, output, wheel); });
            }
        });
        QTimer::singleShot(100000, &app, [] { QCoreApplication::exit(4); });
    }
    if (parser.isSet("smoke-test")) {
        if (parser.isSet("smoke-overlay-pipeline")) {
            auto *overlay = window->findChild<QQuickWindow *>("voiceOverlay");
            auto *shell = overlay ? overlay->findChild<QQuickItem *>("overlayShell") : nullptr;
            if (!shell)
                return 5;
            window->hide();
            overlay->setProperty("compact", parser.value("smoke-overlay") != "full");
            auto started = std::make_shared<bool>(false);
            auto sawFinishing = std::make_shared<bool>(false);
            auto flickered = std::make_shared<bool>(false);
            auto ending = std::make_shared<bool>(false);
            auto completed = std::make_shared<int>(0);
            auto freshFrames = std::make_shared<int>(0);
            const auto pcm = parser.value("smoke-overlay-pipeline");
            const auto screenshot = parser.value("smoke-test");
            QObject::connect(shell, &QQuickItem::opacityChanged, window, [=, &controller] {
                if (*started && controller.sessionActive() && !controller.recording() && shell->opacity() < 0.99)
                    *flickered = true;
            });
            QObject::connect(overlay, &QWindow::visibleChanged, window, [=, &controller](bool visible) {
                if (*started && controller.sessionActive() && (!visible || overlay->opacity() > 0))
                    *flickered = true;
            });
            QObject::connect(overlay, &QWindow::opacityChanged, window, [=, &controller](qreal opacity) {
                if (opacity < 0.99 || !controller.sessionActive())
                    return;
                ++*freshFrames;
                if (!controller.recording() || !overlay->property("committed").toString().isEmpty() ||
                    !overlay->property("live").toString().isEmpty() ||
                    overlay->position() != controller.overlayPosition() ||
                    overlay->property("waitingForFirstFrame").toBool())
                    *flickered = true;
            });
            QObject::connect(&controller, &AppController::changed, window, [=, &controller, &app] {
                if (!*started && controller.state() == "ready") {
                    *started = true;
                    controller.transcribeForTest(pcm, 16000, 1, 500);
                } else if (*started && controller.sessionActive() && !controller.recording() && !*sawFinishing) {
                    *sawFinishing = true;
                    QTimer::singleShot(0, window, [=] {
                        if (!overlay->isVisible() || overlay->opacity() < 0.99 || shell->opacity() < 0.99)
                            *flickered = true;
                        overlay->grabWindow().save(screenshot);
                    });
                } else if (*started && !controller.sessionActive() && !*ending) {
                    *ending = true;
                    QTimer::singleShot(250, window, [=, &controller, &app] {
                        ++*completed;
                        const bool ok = *sawFinishing && !*flickered && !overlay->isVisible() &&
                                        overlay->opacity() == 0 && !controller.result().isEmpty() &&
                                        *freshFrames == *completed;
                        if (ok && *completed < 2) {
                            *sawFinishing = false;
                            *ending = false;
                            controller.transcribeForTest(pcm, 16000, 1, 500);
                            return;
                        }
                        qInfo() << "Overlay recording-to-finishing continuity:" << ok << "sessions:" << *completed
                                << "fresh frames:" << *freshFrames;
                        app.exit(ok ? 0 : 13);
                    });
                }
            });
            QTimer::singleShot(100000, window, [] { QCoreApplication::exit(4); });
            return app.exec();
        }
        if (parser.isSet("smoke-resource-refresh")) {
            const auto screenshot = parser.value("smoke-test");
            auto previous = std::make_shared<QMap<QString, QPointer<QObject>>>();
            auto refreshes = std::make_shared<int>(0);
            QObject::connect(&controller, &AppController::resourcesChanged, window, [=] {
                QTimer::singleShot(0, window, [=] {
                    QList<QObject *> rows;
                    const auto collect = [&rows](auto &&self, QQuickItem *item) -> void {
                        if (item->objectName().startsWith("resourceRow-"))
                            rows.append(item);
                        for (auto *child : item->childItems())
                            self(self, child);
                    };
                    collect(collect, window->contentItem());
                    if (rows.isEmpty()) {
                        QCoreApplication::exit(10);
                        return;
                    }
                    for (auto *row : rows) {
                        const auto name = row->objectName();
                        if (previous->contains(name) && previous->value(name) != row) {
                            qCritical() << "Resource delegate recreated:" << name;
                            QCoreApplication::exit(11);
                            return;
                        }
                        previous->insert(name, row);
                    }
                    if (++*refreshes >= 4) {
                        qInfo() << "Resource delegates retained across" << *refreshes << "updates";
                        QCoreApplication::exit(window->grabWindow().save(screenshot) ? 0 : 3);
                    }
                });
            });
            QTimer::singleShot(15000, window, [] { QCoreApplication::exit(12); });
            return app.exec();
        }
        auto scheduled = std::make_shared<bool>(false);
        const auto screenshot = parser.value("smoke-test");
        const auto overlayLayout = parser.value("smoke-overlay");
        const auto scrollPosition = parser.value("smoke-scroll").toDouble();
        const bool nativeFrame = parser.isSet("smoke-native-frame");
        const bool uiOnly = parser.isSet("smoke-ui-only");
        auto finish = [scheduled, screenshot, overlayLayout, scrollPosition, nativeFrame, uiOnly, window, &controller,
                       &app] {
            if (*scheduled)
                return;
            if (controller.state() == "ready" || controller.state() == "error") {
                *scheduled = true;
                auto *captureWindow = window;
                if (scrollPosition > 0) {
                    auto *scroll = window->findChild<QObject *>("settingsScroll");
                    if (auto *content = qvariant_cast<QQuickItem *>(scroll->property("contentItem")))
                        content->setProperty("contentY", scrollPosition);
                }
                if (!overlayLayout.isEmpty()) {
                    captureWindow = window->findChild<QQuickWindow *>("voiceOverlay");
                    if (!captureWindow) {
                        app.exit(5);
                        return;
                    }
                    window->hide();
                    captureWindow->setProperty("compact", overlayLayout == "compact");
                    captureWindow->setProperty("position", QPoint(200, 200));
                    captureWindow->setProperty("busy", true);
                    captureWindow->setProperty("levels", QVariantList{0.2, 0.7, 0.9, 0.5, 0.3});
                    captureWindow->setProperty("committed", QString::fromUtf8("完全就是给懒鬼用的。"));
                    captureWindow->setProperty("live", QString::fromUtf8("明天早上九点开会。"));
                    captureWindow->setProperty("message", QString::fromUtf8("正在听"));
                    captureWindow->setProperty("sessionActive", true);
                }
                QTimer::singleShot(600, &app, [screenshot, nativeFrame, uiOnly, captureWindow, &controller, &app] {
                    if (captureWindow->objectName() == "voiceOverlay") {
                        auto *shell = captureWindow->findChild<QObject *>("overlayShell");
                        if (!captureWindow->isVisible() || !shell || shell->property("width").toDouble() <= 0 ||
                            shell->property("height").toDouble() <= 0 || shell->property("opacity").toDouble() < 0.99) {
                            app.exit(6);
                            return;
                        }
                    }
                    const bool saved =
                        nativeFrame ? captureWindow->screen()->grabWindow(captureWindow->winId()).save(screenshot)
                                    : captureWindow->grabWindow().save(screenshot);
                    if (captureWindow->objectName() == "voiceOverlay" && saved) {
                        captureWindow->setProperty("sessionActive", false);
                        QTimer::singleShot(250, &app,
                                           [captureWindow, &app] { app.exit(captureWindow->isVisible() ? 7 : 0); });
                        return;
                    }
                    app.exit(saved && (uiOnly || controller.state() == "ready") ? 0 : 3);
                });
            }
        };
        QObject::connect(&controller, &AppController::changed, &app, finish);
        QTimer::singleShot(100000, &app, [] { QCoreApplication::exit(4); });
    }
    return app.exec();
}
