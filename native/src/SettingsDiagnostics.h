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
#include <dwmapi.h>
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
        double scrollY = 0, popupY = 0, selectY = 0;
        QJsonObject result;
        QPointer<QQuickItem> editor, view, select;
        QPointer<QObject> popup;
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
    const auto pointer = [=](QPointF point, bool pressed) {
#ifdef Q_OS_WIN
        const auto handle = reinterpret_cast<HWND>(window->winId());
        const auto nativePoint = (point * window->devicePixelRatio()).toPoint();
        const auto coordinates = MAKELPARAM(nativePoint.x(), nativePoint.y());
        PostMessage(handle, pressed ? WM_LBUTTONDOWN : WM_LBUTTONUP, pressed ? MK_LBUTTON : 0, coordinates);
#else
        const QPointF global(window->mapToGlobal(point.toPoint()));
        QMouseEvent event(pressed ? QEvent::MouseButtonPress : QEvent::MouseButtonRelease, point, global,
                          Qt::LeftButton, pressed ? Qt::LeftButton : Qt::NoButton, Qt::NoModifier);
        QCoreApplication::sendEvent(window, &event);
#endif
    };
    const auto click = [=](QPointF point) {
        pointer(point, true);
        pointer(point, false);
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
                const auto handle = reinterpret_cast<HWND>(window->winId());
                const auto region = CreateRectRgn(0, 0, 0, 0);
                const bool unmasked = GetWindowRgn(handle, region) == ERROR;
                DeleteObject(region);
                DWORD preference = 0;
                BOOL rendering = FALSE;
                const bool nativeFrame =
                    SUCCEEDED(DwmGetWindowAttribute(handle, 33, &preference, sizeof(preference))) && preference == 2 &&
                    SUCCEEDED(
                        DwmGetWindowAttribute(handle, DWMWA_NCRENDERING_ENABLED, &rendering, sizeof(rendering))) &&
                    rendering;
                check->result["nativeCompositedFrame"] = nativeFrame && unmasked;
                if (!nativeFrame || !unmasked) {
                    finish("Native composited frame missing or masked");
                    return;
                }
                const auto frame = window->frameGeometry().adjusted(-24, -24, 24, 24);
                window->screen()
                    ->grabWindow(0, frame.x(), frame.y(), frame.width(), frame.height())
                    .save(output + ".native-frame.png");
            }
#endif
            // Enable both groups so the trigger page can scroll its first
            // dropdown offscreen even when unrelated controls move elsewhere.
            controller->setSetting("mouseEnabled", true);
            window->setProperty("page", 0);
            window->setHeight(520);
            break;
        case 6: {
            check->select = settingsItem(window->contentItem(), "select-keyboardMode");
            if (!check->select) {
                finish("Dropdown missing");
                return;
            }
            pointer(check->select->mapToItem(window->contentItem(), QPointF(30, 16)), true);
            break;
        }
        case 7:
            check->popup = window->property("activeSelectPopup").value<QObject *>();
            if (!check->popup || !check->popup->property("visible").toBool()) {
                finish("Dropdown did not open on mouse press");
                return;
            }
            check->result["dropdownOpensOnPress"] = true;
            pointer(check->select->mapToItem(window->contentItem(), QPointF(30, 16)), false);
            break;
        case 8: {
            if (check->popup->property("opacity").toDouble() < 0.99) return;
            if (!check->popup->property("visible").toBool()) {
                finish("Mouse release closed dropdown");
                return;
            }
            window->grabWindow().save(output + ".dropdown.png");
            check->popupY = check->popup->property("y").toDouble();
            check->selectY = check->select->mapToItem(window->contentItem(), QPointF{}).y();
            const QPointF point(window->width() - 35, window->height() - 90);
#ifdef Q_OS_WIN
            const auto handle = reinterpret_cast<HWND>(window->winId());
            const auto native = (point * window->devicePixelRatio()).toPoint();
            POINT global{native.x(), native.y()};
            ClientToScreen(handle, &global);
            PostMessage(handle, WM_MOUSEWHEEL, MAKEWPARAM(0, WORD(-120)), MAKELPARAM(global.x, global.y));
#else
            QWheelEvent event(point, window->mapToGlobal(point.toPoint()), {}, QPoint(0, -120), Qt::NoButton,
                              Qt::NoModifier, Qt::NoScrollPhase, false);
            QCoreApplication::sendEvent(window, &event);
#endif
            break;
        }
        case 9:
            if (auto *animation = window->findChild<QObject *>("settingsWheelAnimation");
                animation && animation->property("running").toBool()) return;
            if (!check->popup->property("visible").toBool() ||
                qAbs((check->popup->property("y").toDouble() - check->popupY) -
                     (check->select->mapToItem(window->contentItem(), QPointF{}).y() - check->selectY)) > 1) {
                finish("Dropdown did not follow its visible anchor");
                return;
            }
            check->result["dropdownFollowsPageScroll"] = true;
            check->view->setProperty("contentY", check->view->property("contentY").toDouble() +
                check->select->mapToItem(window->contentItem(), QPointF{}).y() + check->select->height());
            break;
        case 10:
            if (check->popup->property("visible").toBool() || check->select->hasActiveFocus()) {
                finish("Offscreen anchor kept dropdown or focus");
                return;
            }
            check->result["offscreenAnchorClosesDropdown"] = true;
            check->view->setProperty("contentY", 0);
            break;
        case 11:
            click(check->select->mapToItem(window->contentItem(), QPointF(30, 16)));
            break;
        case 12:
            click(QPointF(window->width() - 35, window->height() - 90));
            break;
        case 13:
            if (check->popup->property("visible").toBool() || check->select->hasActiveFocus()) {
                finish("Outside press kept dropdown or its focus");
                return;
            }
            check->result["outsidePressClearsDropdownFocus"] = true;
            controller->setServiceEnabled(true);
            break;
        case 14:
            click(check->select->mapToItem(window->contentItem(), QPointF(30, 16)));
            break;
        case 15: {
            auto *list = check->popup->property("contentItem").value<QQuickItem *>();
            if (!check->popup->property("visible").toBool() || !list) {
                finish("Dropdown failed to reopen for selection");
                return;
            }
            click(list->mapToItem(window->contentItem(), QPointF(30, 34 + 17)));
            break;
        }
        case 16:
            check->select = settingsItem(window->contentItem(), "select-keyboardMode");
            if (!check->select || check->select->property("currentIndex").toInt() != 1 ||
                (check->popup && check->popup->property("visible").toBool()) ||
                controller->settings().value("keyboardMode").toString() != "toggle") {
                finish("Dropdown selection did not update setting");
                return;
            }
            check->result["dropdownSelectionWorks"] = true;
            break;
        case 17:
            if (controller->state() != "ready")
                return;
            check->result["resumed"] = true;
            controller->setServiceEnabled(false);
            controller->setServiceEnabled(true);
            controller->setServiceEnabled(false); // Stop again while the workers are loading.
            break;
        case 18:
            check->result["pausedDuringLoad"] =
                controller->state() == "paused" && controller->resourceProcesses()->rowCount() == 1;
            if (!check->result["pausedDuringLoad"].toBool()) {
                finish("Workers survived pause during load"); return;
            }
            window->setProperty("page", 5);
            break;
        case 19: {
            auto *input = settingsItem(window->contentItem(), "input-idleUnloadMin");
            if (!input) { finish("Number field missing"); return; }
            input->setProperty("text", "999");
            QMetaObject::invokeMethod(input, "editingFinished");
            if (!input->property("invalid").toBool() || input->property("text") != "999" ||
                !controller->settingErrors().contains("idleUnloadMin")) {
                finish("Invalid number was not retained and identified inline"); return;
            }
            check->view->setProperty("contentY", check->view->property("contentY").toDouble() +
                input->mapToItem(window->contentItem(), QPointF{}).y() - 200);
            break;
        }
        case 20: {
            window->grabWindow().save(output + ".number-error.png");
            auto *input = settingsItem(window->contentItem(), "input-idleUnloadMin");
            if (!input) { finish("Number field disappeared after validation"); return; }
            input->setProperty("text", "12");
            QMetaObject::invokeMethod(input, "editingFinished");
            if (input->property("invalid").toBool() || controller->settings()["idleUnloadMin"] != 12) {
                finish("Corrected number was not saved"); return;
            }
            check->result["inlineNumberErrorAndRecovery"] = true;
            window->setProperty("page", 8);
            // Read immediately upon page construction, before animations finish.
            const auto rows = controller->resourceProcesses()->rowCount();
            int found = 0;
            const auto inspect = [&](auto &&self, QQuickItem *item) -> bool {
                if (item->objectName().startsWith("resourceBar-")) {
                    ++found;
                    if (qAbs(item->property("displayedPosition").toDouble() - item->property("visualPosition").toDouble()) > 0.001)
                        return false;
                }
                for (auto *child : item->childItems()) if (!self(self, child)) return false;
                return true;
            };
            if (!inspect(inspect, window->contentItem()) || found != rows || found == 0) {
                finish("Resource bars did not start at their current values"); return;
            }
            check->result["resourceBarsStartAtCurrentValues"] = true;
            finish({});
            return;
        }
        }
        ++check->step;
    });
    timer->start();
}
