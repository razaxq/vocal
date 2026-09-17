#pragma once
#include "AppController.h"
#include <QCoreApplication>
#include <QFile>
#include <QJsonDocument>
#include <QMouseEvent>
#include <QQuickItem>
#include <QQuickWindow>
#include <QScreen>
#include <QTimer>
#include <QWheelEvent>
#include <memory>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

inline QQuickItem *settingsItem(QQuickItem *root, const QString &name) {
    if (root->objectName() == name)
        return root;
    for (auto *child : root->childItems())
        if (auto *match = settingsItem(child, name))
            return match;
    return nullptr;
}

// Opt-in regression exercise using actual Qt pointer events and worker processes.
inline void verifySettings(QQuickWindow *window, AppController *controller, const QString &output) {
    struct Check {
        int step = 0, ticks = 0;
        double scrollY = 0;
        QJsonObject result;
        QPointer<QQuickItem> editor, view;
    };
    auto check = std::make_shared<Check>();
    auto *timer = new QTimer(window);
    timer->setInterval(250);
    const auto finish = [=](const QString &error) {
        timer->stop();
        if (!error.isEmpty())
            window->grabWindow().save(output + ".failure.png");
        check->result["error"] = error;
        QFile file(output);
        const auto bytes = QJsonDocument(check->result).toJson();
        const bool saved = file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
        qInfo().noquote() << bytes;
        QCoreApplication::exit(error.isEmpty() && saved ? 0 : 9);
    };
    const auto click = [=](QPointF point) {
#ifdef Q_OS_WIN
        const auto handle = reinterpret_cast<HWND>(window->winId());
        const auto nativePoint = (point * window->devicePixelRatio()).toPoint();
        const auto coordinates = MAKELPARAM(nativePoint.x(), nativePoint.y());
        PostMessage(handle, WM_LBUTTONDOWN, MK_LBUTTON, coordinates);
        PostMessage(handle, WM_LBUTTONUP, 0, coordinates);
#else
        const QPointF global(window->mapToGlobal(point.toPoint()));
        QMouseEvent down(QEvent::MouseButtonPress, point, global, Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
        QMouseEvent up(QEvent::MouseButtonRelease, point, global, Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
        QCoreApplication::sendEvent(window, &down);
        QCoreApplication::sendEvent(window, &up);
#endif
    };
    QObject::connect(timer, &QTimer::timeout, window, [=] {
        if (++check->ticks > 400) {
            finish("Timed out at step " + QString::number(check->step));
            return;
        }
        switch (check->step) {
        case 0:
            if (controller->state() == "paused") {
                if (controller->resourceProcesses()->rowCount() == 0)
                    return;
                if (controller->resourceProcesses()->rowCount() != 1) {
                    finish("Disabled startup loaded workers");
                    return;
                }
                check->result["disabledStartup"] = true;
                controller->setServiceEnabled(true);
                return;
            }
            if (controller->state() != "ready" || controller->resourceProcesses()->rowCount() < 2)
                return;
            check->result["loadedProcesses"] = controller->resourceProcesses()->rowCount();
            controller->setServiceEnabled(false);
            if (controller->state() != "paused" || controller->resourceProcesses()->rowCount() != 1) {
                finish("Pausing did not release workers");
                return;
            }
            controller->reloadModel();
            controller->toggleRecording();
            controller->toggleMicTest();
            window->setProperty("page", 1);
            window->requestActivate();
            break;
        case 1: {
            if (controller->recording() || controller->testing() || controller->state() != "paused") {
                finish("Paused service accepted recording");
                return;
            }
            check->editor = window->findChild<QQuickItem *>("words-hotwords");
            auto *scroll = window->findChild<QObject *>("settingsScroll");
            check->view = scroll ? qvariant_cast<QQuickItem *>(scroll->property("contentItem")) : nullptr;
            if (!check->editor || !check->view) {
                finish("Hotword editor not found");
                return;
            }
            const auto top = check->editor->mapToItem(window->contentItem(), QPointF{}).y();
            check->view->setProperty("contentY", check->view->property("contentY").toDouble() + top - 200);
            break;
        }
        case 2:
            check->result["editorY"] = check->editor->mapToItem(window->contentItem(), QPointF{}).y();
            check->result["viewY"] = check->view->property("contentY").toDouble();
            window->requestActivate();
            click(check->editor->mapToItem(window->contentItem(), QPointF(30, 20)));
            break;
        case 3: {
            if (!check->editor->hasActiveFocus()) {
                check->result["focusItem"] =
                    window->activeFocusItem() ? window->activeFocusItem()->objectName() : "null";
                finish("Click did not focus editor");
                return;
            }
            check->scrollY = check->view->property("contentY").toDouble();
            const auto point = check->editor->mapToItem(window->contentItem(), QPointF(30, 20));
#ifdef Q_OS_WIN
            const auto handle = reinterpret_cast<HWND>(window->winId());
            const auto native = (point * window->devicePixelRatio()).toPoint();
            POINT global{native.x(), native.y()};
            ClientToScreen(handle, &global);
            PostMessage(handle, WM_MOUSEWHEEL, MAKEWPARAM(0, WORD(120)), MAKELPARAM(global.x, global.y));
#else
            QWheelEvent wheel(point, window->mapToGlobal(point.toPoint()), {}, QPoint(0, 120), Qt::NoButton,
                              Qt::NoModifier, Qt::NoScrollPhase, false);
            QCoreApplication::sendEvent(window, &wheel);
#endif
            break;
        }
        case 4:
            check->result["hotwordWheelScroll"] = check->view->property("contentY").toDouble() - check->scrollY;
            if (check->result["hotwordWheelScroll"].toDouble() > -20) {
                finish("Wheel over editor did not scroll page");
                return;
            }
            click(QPointF(window->width() - 35, 95));
            break;
        case 5:
            if (check->editor->hasActiveFocus()) {
                finish("Outside click kept editor focus");
                return;
            }
            check->result["outsideClickClearsFocus"] = true;
            window->grabWindow().save(output + ".hotwords.png");
#ifdef Q_OS_WIN
            {
                const auto region = CreateRectRgn(0, 0, 0, 0);
                const bool rounded = GetWindowRgn(reinterpret_cast<HWND>(window->winId()), region) != ERROR &&
                                     !PtInRegion(region, 0, 0) &&
                                     PtInRegion(region, qRound(18 * window->devicePixelRatio()), 1);
                DeleteObject(region);
                check->result["nativeRoundedCorners"] = rounded;
                if (!rounded) {
                    finish("Native corner region missing");
                    return;
                }
                window->screen()->grabWindow(window->winId()).save(output + ".native-frame.png");
            }
#endif
            window->setProperty("page", 0);
            break;
        case 6: {
            auto *select = settingsItem(window->contentItem(), "select-keyboardMode");
            if (!select) {
                finish("Dropdown missing");
                return;
            }
            click(select->mapToItem(window->contentItem(), QPointF(select->width() / 2, select->height() / 2)));
            break;
        }
        case 7:
            window->grabWindow().save(output + ".dropdown.png");
            controller->setServiceEnabled(true);
            break;
        case 8:
            if (controller->state() != "ready")
                return;
            check->result["resumed"] = true;
            controller->setServiceEnabled(false);
            controller->setServiceEnabled(true);
            controller->setServiceEnabled(false); // Stop again while the workers are loading.
            break;
        case 9:
            check->result["pausedDuringLoad"] =
                controller->state() == "paused" && controller->resourceProcesses()->rowCount() == 1;
            finish(check->result["pausedDuringLoad"].toBool() ? QString{} : "Workers survived pause during load");
            return;
        }
        ++check->step;
    });
    timer->start();
}
