#pragma once
#include <QSystemTrayIcon>
#include <QWindow>

// show() alone keeps a minimized window minimized. Clear only that state so
// restoring from the tray preserves maximized/full-screen window preferences.
inline void restoreMainWindow(QWindow *window) {
    const auto states = window->windowStates();
    if (states.testFlag(Qt::WindowFullScreen))
        window->showFullScreen();
    else if (states.testFlag(Qt::WindowMaximized))
        window->showMaximized();
    else
        window->showNormal();
    window->raise();
    window->requestActivate();
}

inline void connectTrayActivation(QSystemTrayIcon *tray, QWindow *window) {
    QObject::connect(tray, &QSystemTrayIcon::activated, window, [window](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick)
            restoreMainWindow(window);
    });
}
