// Tiny, installer-only Win32 frame. Build as x86 for NSIS; resolve OS APIs at
// attachment time so no extra C/C++ runtime or second toolchain is distributed.
#include <windows.h>
void InitializeFolderPicker(decltype(&GetProcAddress), decltype(&GetModuleHandleW));

namespace {
using Resolver = decltype(&GetProcAddress);
using Modules = decltype(&GetModuleHandleW);
#define API(name) decltype(&::name) api##name
API(CallWindowProcW); API(SetWindowLongW); API(GetWindowLongW);
API(CreateWindowExW); API(GetClientRect); API(SetWindowPos);
API(ScreenToClient); API(PostMessageW); API(ShowWindow);
API(GetDlgItem); API(IsWindowEnabled); API(InvalidateRect);
API(TrackMouseEvent); API(FillRect); API(DrawTextW);
API(GetDpiForWindow); API(SaveDC); API(RestoreDC);
API(CreateFontW); API(SelectObject); API(DeleteObject);
API(CreateSolidBrush); API(SetTextColor); API(SetBkMode);
API(GetCursorPos); API(WindowFromPoint); API(DrawFocusRect); API(GetPropW);
#undef API
WNDPROC originalFrame, originalButton;
HWND frame, closeButton, minimizeButton, hovered;
HFONT closeFont, minimizeFont;
int dpi = 96;
constexpr int closeId = 0x7101, minimizeId = 0x7102;
int scaled(int value) { return (value * dpi + 48) / 96; }
bool finished() { return apiGetPropW(frame, L"Vocal.InstallComplete") != nullptr; }

void clearHover() {
    const HWND previous = hovered;
    hovered = nullptr;
    if (previous) apiInvalidateRect(previous, nullptr, FALSE);
}

void layout() {
    RECT bounds;
    apiGetClientRect(frame, &bounds);
    apiSetWindowPos(minimizeButton, nullptr, bounds.right - scaled(88), 0,
                    scaled(44), scaled(36), SWP_NOZORDER | SWP_NOACTIVATE);
    apiSetWindowPos(closeButton, nullptr, bounds.right - scaled(44), 0,
                    scaled(44), scaled(36), SWP_NOZORDER | SWP_NOACTIVATE);
}

LRESULT CALLBACK buttonProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_MOUSEMOVE && hovered != hwnd) {
        clearHover();
        hovered = hwnd;
        TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, hwnd, 0};
        apiTrackMouseEvent(&track);
        apiInvalidateRect(hwnd, nullptr, FALSE);
    } else if (msg == WM_MOUSELEAVE || msg == WM_CANCELMODE || msg == WM_CAPTURECHANGED) {
        if (hovered == hwnd) clearHover();
        apiInvalidateRect(hwnd, nullptr, FALSE);
    }
    return apiCallWindowProcW(originalButton, hwnd, msg, wp, lp);
}

LRESULT CALLBACK frameProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if ((msg == WM_ACTIVATE && LOWORD(wp) == WA_INACTIVE)
        || (msg == WM_ENABLE && !wp) || msg == WM_CANCELMODE) clearHover();
    // NSIS disables Cancel on its final page too. Closing that page should
    // complete the wizard and honor its launch switch, just like Finish.
    if (msg == WM_CLOSE && finished()) {
        apiPostMessageW(hwnd, WM_COMMAND, IDOK, 0);
        return 0;
    }
    if (msg == WM_NCCALCSIZE) return 0; // Keep DWM composition, remove stock caption.
    if (msg == WM_NCHITTEST) {
        POINT point{static_cast<short>(LOWORD(lp)), static_cast<short>(HIWORD(lp))};
        apiScreenToClient(hwnd, &point);
        RECT bounds;
        apiGetClientRect(hwnd, &bounds);
        return point.y >= 0 && point.y < scaled(36)
            && point.x < bounds.right - scaled(88) ? HTCAPTION : HTCLIENT;
    }
    if (msg == WM_NCLBUTTONDBLCLK && wp == HTCAPTION) return 0;
    if (msg == WM_COMMAND && HIWORD(wp) == BN_CLICKED) {
        if (LOWORD(wp) == minimizeId) {
            clearHover();
            apiShowWindow(hwnd, SW_MINIMIZE);
            return 0;
        }
        if (LOWORD(wp) == closeId) {
            clearHover();
            // Respect NSIS's disabled Cancel state while files are being copied.
            if (finished() || apiIsWindowEnabled(apiGetDlgItem(hwnd, IDCANCEL)))
                apiPostMessageW(hwnd, WM_CLOSE, 0, 0);
            return 0;
        }
    }
    if (msg == WM_DRAWITEM && (wp == closeId || wp == minimizeId)) {
        auto *draw = reinterpret_cast<DRAWITEMSTRUCT *>(lp);
        const bool closing = wp == closeId;
        const bool enabled = apiIsWindowEnabled(hwnd) && (!closing || finished()
            || apiIsWindowEnabled(apiGetDlgItem(hwnd, IDCANCEL)));
        POINT cursor;
        const bool underPointer = apiGetCursorPos(&cursor)
            && apiWindowFromPoint(cursor) == draw->hwndItem;
        // Keyboard focus survives a cancelled dialog; it is not hover/press.
        const bool hot = enabled && ((hovered == draw->hwndItem && underPointer)
            || (draw->itemState & ODS_SELECTED));
        const int saved = apiSaveDC(draw->hDC);
        HBRUSH background = apiCreateSolidBrush(hot
            ? (closing ? RGB(245,108,108) : RGB(238,240,243)) : RGB(255,255,255));
        apiFillRect(draw->hDC, &draw->rcItem, background);
        apiDeleteObject(background);
        apiSetBkMode(draw->hDC, TRANSPARENT);
        apiSetTextColor(draw->hDC, !enabled ? RGB(144,147,153)
            : hot && closing ? RGB(255,255,255) : RGB(96,98,102));
        apiSelectObject(draw->hDC, closing ? closeFont : minimizeFont);
        apiDrawTextW(draw->hDC, closing ? L"\u00d7" : L"\u2212", 1,
                      &draw->rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        if (enabled && (draw->itemState & ODS_FOCUS) && !(draw->itemState & ODS_NOFOCUSRECT)) {
            RECT focus = draw->rcItem;
            focus.left += scaled(5); focus.right -= scaled(5);
            focus.top += scaled(5); focus.bottom -= scaled(5);
            apiDrawFocusRect(draw->hDC, &focus);
        }
        apiRestoreDC(draw->hDC, saved);
        return TRUE;
    }
    const LRESULT result = apiCallWindowProcW(originalFrame, hwnd, msg, wp, lp);
    if (msg == WM_SIZE && closeButton) layout();
    if (msg == WM_NCDESTROY) {
        apiDeleteObject(closeFont);
        apiDeleteObject(minimizeFont);
    }
    return result;
}
}

extern "C" __declspec(dllexport) int __stdcall AttachFrame(
    HWND hwnd, Resolver resolve, Modules module, int language) {
    InitializeFolderPicker(resolve, module);
    HMODULE user = module(L"user32.dll"), gdi = module(L"gdi32.dll");
#define LOAD(lib, name) api##name = reinterpret_cast<decltype(api##name)>(resolve(lib, #name)); if (!api##name) return 0
    LOAD(user, CallWindowProcW); LOAD(user, SetWindowLongW); LOAD(user, GetWindowLongW);
    LOAD(user, CreateWindowExW); LOAD(user, GetClientRect); LOAD(user, SetWindowPos);
    LOAD(user, ScreenToClient); LOAD(user, PostMessageW); LOAD(user, ShowWindow);
    LOAD(user, GetDlgItem); LOAD(user, IsWindowEnabled); LOAD(user, InvalidateRect);
    LOAD(user, TrackMouseEvent); LOAD(user, FillRect); LOAD(user, DrawTextW);
    LOAD(user, GetDpiForWindow);
    LOAD(user, GetCursorPos); LOAD(user, WindowFromPoint);
    LOAD(user, DrawFocusRect); LOAD(user, GetPropW);
    LOAD(gdi, SaveDC); LOAD(gdi, RestoreDC); LOAD(gdi, CreateFontW);
    LOAD(gdi, SelectObject); LOAD(gdi, DeleteObject); LOAD(gdi, CreateSolidBrush);
    LOAD(gdi, SetTextColor); LOAD(gdi, SetBkMode);
#undef LOAD
    frame = hwnd;
    dpi = static_cast<int>(apiGetDpiForWindow(hwnd));
    if (!dpi) dpi = 96;
    closeFont = apiCreateFontW(-scaled(18), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");
    minimizeFont = apiCreateFontW(-scaled(13), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");
    originalFrame = reinterpret_cast<WNDPROC>(apiSetWindowLongW(hwnd, GWLP_WNDPROC,
        reinterpret_cast<LONG>(frameProc)));
    apiSetWindowLongW(hwnd, GWL_STYLE, apiGetWindowLongW(hwnd, GWL_STYLE)
        & ~(WS_CAPTION | WS_THICKFRAME | WS_MAXIMIZEBOX));
    apiSetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    const DWORD style = WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW;
    const bool chinese = PRIMARYLANGID(language) == LANG_CHINESE;
    minimizeButton = apiCreateWindowExW(0, L"BUTTON", chinese ? L"\u6700\u5c0f\u5316" : L"Minimize",
        style, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(minimizeId), nullptr, nullptr);
    closeButton = apiCreateWindowExW(0, L"BUTTON", chinese ? L"\u5173\u95ed" : L"Close",
        style, 0, 0, 0, 0, hwnd, reinterpret_cast<HMENU>(closeId), nullptr, nullptr);
    originalButton = reinterpret_cast<WNDPROC>(apiSetWindowLongW(minimizeButton, GWLP_WNDPROC,
        reinterpret_cast<LONG>(buttonProc)));
    apiSetWindowLongW(closeButton, GWLP_WNDPROC, reinterpret_cast<LONG>(buttonProc));
    layout();
    return scaled(36);
}
