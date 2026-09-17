#pragma once
#include <QWindow>
#include <QVariant>
#ifdef Q_OS_WIN
#include <windows.h>
#include <dwmapi.h>
#endif

inline void applyWindowChrome(QWindow *window) {
#ifdef Q_OS_WIN
    // A native region gives an 18-DIP radius without a transparent Qt window
    // or an extra GPU masking layer. DWM only exposes small/default radii.
    const auto handle = reinterpret_cast<HWND>(window->winId());
    const DWORD round = 2; // DWMWCP_ROUND (Windows 11; harmless on older systems).
    DwmSetWindowAttribute(handle, 33, &round, sizeof(round));
    RECT rect{};
    if (!GetWindowRect(handle, &rect))
        return;
    const bool square = window->windowState() == Qt::WindowMaximized || window->windowState() == Qt::WindowFullScreen;
    const int diameter = qRound(36 * window->devicePixelRatio());
    const auto key =
        QString("%1:%2:%3:%4").arg(rect.right - rect.left).arg(rect.bottom - rect.top).arg(diameter).arg(square);
    if (window->property("chromeRegion").toString() == key)
        return;
    window->setProperty("chromeRegion", key);
    if (square) {
        SetWindowRgn(handle, nullptr, TRUE);
    } else {
        const auto region =
            CreateRoundRectRgn(0, 0, rect.right - rect.left + 1, rect.bottom - rect.top + 1, diameter, diameter);
        if (region && !SetWindowRgn(handle, region, TRUE))
            DeleteObject(region); // On success Windows owns and frees the region.
    }
#else
    Q_UNUSED(window);
#endif
}
