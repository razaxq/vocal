#pragma once
#include <QWindow>
#ifdef Q_OS_WIN
#include <windows.h>
#include <dwmapi.h>
#endif

inline void applyWindowChrome(QWindow *window) {
#ifdef Q_OS_WIN
    const auto handle = reinterpret_cast<HWND>(window->winId());
    // A region is a hard pixel mask: it loses antialiasing and prevents DWM
    // from composing rounded corners and their matching shadow.
    SetWindowRgn(handle, nullptr, TRUE);
    const DWORD round = 2; // DWMWCP_ROUND (Windows 11).
    DwmSetWindowAttribute(handle, 33, &round, sizeof(round));
    const DWMNCRENDERINGPOLICY policy = DWMNCRP_ENABLED;
    DwmSetWindowAttribute(handle, DWMWA_NCRENDERING_POLICY, &policy, sizeof(policy));
    const MARGINS frame{1, 1, 1, 1};
    DwmExtendFrameIntoClientArea(handle, &frame);
#else
    Q_UNUSED(window);
#endif
}
