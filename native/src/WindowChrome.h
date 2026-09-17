#pragma once
#include <QWindow>
#ifdef Q_OS_WIN
#include <windows.h>
#include <dwmapi.h>
#endif

inline void applyWindowChrome(QWindow *window) {
#ifdef Q_OS_WIN
    // Keep the main window opaque and let DWM clip its corners. Avoid a
    // per-pixel transparent or masked top-level window and an extra GPU layer.
    // https://learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-rounded-corners
    const DWORD round = 2; // DWMWCP_ROUND (Windows 11; harmless on older systems).
    DwmSetWindowAttribute(reinterpret_cast<HWND>(window->winId()), 33, &round, sizeof(round));
#else
    Q_UNUSED(window);
#endif
}
