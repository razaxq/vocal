#include "Platform.h"
#include <QCoreApplication>
#include <QGuiApplication>
#include <QMap>
#include <QScreen>
#include <QVector>
#include <atomic>
#include <future>
#include <thread>
#include <windows.h>

class WindowsPlatform final : public Platform {
    HHOOK keyboard = nullptr, mouse = nullptr;
    std::atomic<int> m_key{VK_RCONTROL};
    std::atomic<int> m_modifiers{0};
    int m_releasedTrigger = 0;
    std::atomic<bool> m_keyPhysical{false};
    std::atomic<bool> m_keyboardEnabled{true}, m_keyboardFullscreen{false}, m_combo{false};
    std::thread m_hookThread;
    std::atomic<DWORD> m_hookThreadId{0};
    static inline WindowsPlatform *instance = nullptr;
    static LRESULT CALLBACK keyboardProc(int code, WPARAM message, LPARAM data) {
        if (code == HC_ACTION && instance) {
            const auto *event = reinterpret_cast<KBDLLHOOKSTRUCT *>(data);
            if (!(event->flags & LLKHF_INJECTED) && event->vkCode == VK_ESCAPE && message == WM_KEYDOWN) {
                QMetaObject::invokeMethod(
                    instance,
                    [] {
                        if (instance)
                            emit instance->escapePressed();
                    },
                    Qt::QueuedConnection);
            }
            if (!(event->flags & LLKHF_INJECTED) && int(event->vkCode) == instance->m_key) {
                const bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                instance->m_keyPhysical = down;
                QMetaObject::invokeMethod(
                    instance,
                    [down] {
                        if (instance)
                            emit instance->inputChanged(0, down);
                    },
                    Qt::QueuedConnection);
                if (instance->m_combo && instance->m_keyboardEnabled && instance->shortcutModifiersMatch() &&
                    (instance->m_keyboardFullscreen || !instance->fullscreen()))
                    return 1;
            }
        }
        return CallNextHookEx(nullptr, code, message, data);
    }
    static LRESULT CALLBACK mouseProc(int code, WPARAM message, LPARAM data) {
        if (code == HC_ACTION && instance) {
            const auto *event = reinterpret_cast<MSLLHOOKSTRUCT *>(data);
            if (!(event->flags & LLMHF_INJECTED)) {
                const int input = message == WM_LBUTTONDOWN || message == WM_LBUTTONUP   ? 1
                                  : message == WM_MBUTTONDOWN || message == WM_MBUTTONUP ? 2
                                                                                         : -1;
                if (input >= 0) {
                    const bool down = message == WM_LBUTTONDOWN || message == WM_MBUTTONDOWN;
                    QMetaObject::invokeMethod(
                        instance,
                        [input, down] {
                            if (instance)
                                emit instance->inputChanged(input, down);
                        },
                        Qt::QueuedConnection);
                }
            }
        }
        return CallNextHookEx(nullptr, code, message, data);
    }

  public:
    bool beginTextInput(quintptr saved, bool triggerOwned, QString *error) override {
        const auto window = reinterpret_cast<HWND>(saved);
        DWORD pid = 0;
        GetWindowThreadProcessId(window, &pid);
        if (!window || !IsWindow(window) || target() != saved || pid == GetCurrentProcessId()) {
            *error = "焦点已变化，结果已保留";
            return false;
        }
        m_releasedTrigger = 0;
        for (int key : {VK_LCONTROL, VK_RCONTROL, VK_LSHIFT, VK_RSHIFT, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN}) {
            if (!(GetAsyncKeyState(key) & 0x8000))
                continue;
            if (!(triggerOwned && !m_combo && m_keyPhysical && key == m_key)) {
                *error = "请松开其他修饰键后输入";
                return false;
            }
        }
        if (triggerOwned && !m_combo && m_keyPhysical &&
            (m_key == VK_LCONTROL || m_key == VK_RCONTROL || m_key == VK_LSHIFT || m_key == VK_RSHIFT ||
             m_key == VK_LMENU || m_key == VK_RMENU || m_key == VK_LWIN || m_key == VK_RWIN)) {
            INPUT event{};
            event.type = INPUT_KEYBOARD;
            event.ki.wVk = WORD(m_key);
            event.ki.dwFlags = KEYEVENTF_KEYUP;
            if (m_key == VK_RCONTROL || m_key == VK_RMENU || m_key == VK_LWIN || m_key == VK_RWIN)
                event.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
            if (SendInput(1, &event, sizeof(INPUT)) != 1) {
                *error = "无法暂停录音快捷键";
                return false;
            }
            m_releasedTrigger = m_key;
        }
        return true;
    }
    void endTextInput() override {
        if (m_releasedTrigger && m_keyPhysical) {
            INPUT event{};
            event.type = INPUT_KEYBOARD;
            event.ki.wVk = WORD(m_releasedTrigger);
            if (m_releasedTrigger == VK_RCONTROL || m_releasedTrigger == VK_RMENU || m_releasedTrigger == VK_LWIN ||
                m_releasedTrigger == VK_RWIN)
                event.ki.dwFlags = KEYEVENTF_EXTENDEDKEY;
            SendInput(1, &event, sizeof(INPUT));
        }
        m_releasedTrigger = 0;
    }
    void configure(const QJsonObject &config) override {
        m_keyboardEnabled = config["keyboardEnabled"].toBool(true);
        m_keyboardFullscreen = config["keyboardInFullscreen"].toBool();
        m_combo = config["keyboardMode"].toString() == "toggle";
        m_modifiers = 0;
        QString key = config["keyboardKey"].toString("CtrlRight");
        if (m_combo) {
            const auto parts = config["accelerator"].toString("Control+Shift+Space").split('+');
            key = parts.last();
            for (auto part : parts) {
                part = part.toLower();
                if (part == "control" || part == "ctrl")
                    m_modifiers |= 1;
                if (part == "shift")
                    m_modifiers |= 2;
                if (part == "alt")
                    m_modifiers |= 4;
                if (part == "win" || part == "meta" || part == "super")
                    m_modifiers |= 8;
            }
        }
        const QMap<QString, int> keys{{"CtrlRight", VK_RCONTROL}, {"Ctrl", VK_LCONTROL},     {"AltRight", VK_RMENU},
                                      {"Alt", VK_LMENU},          {"ShiftRight", VK_RSHIFT}, {"Shift", VK_LSHIFT},
                                      {"MetaRight", VK_RWIN},     {"Meta", VK_LWIN},         {"CapsLock", VK_CAPITAL},
                                      {"Space", VK_SPACE},        {"Enter", VK_RETURN}};
        m_key = keys.value(key, VK_RCONTROL);
        if (key.startsWith('F') && key.mid(1).toInt() >= 1 && key.mid(1).toInt() <= 24)
            m_key = VK_F1 + key.mid(1).toInt() - 1;
        else if (key.size() == 1 && key[0].isLetterOrNumber())
            m_key = key.toUpper()[0].unicode();
    }
    bool shortcutModifiersMatch() const override {
        if (!m_combo)
            return true;
        const int mask = ((GetAsyncKeyState(VK_CONTROL) & 0x8000) ? 1 : 0) |
                         ((GetAsyncKeyState(VK_SHIFT) & 0x8000) ? 2 : 0) |
                         ((GetAsyncKeyState(VK_MENU) & 0x8000) ? 4 : 0) |
                         (((GetAsyncKeyState(VK_LWIN) | GetAsyncKeyState(VK_RWIN)) & 0x8000) ? 8 : 0);
        return mask == m_modifiers;
    }
    QString targetProcess(quintptr target) const override {
        DWORD pid = 0;
        GetWindowThreadProcessId(reinterpret_cast<HWND>(target), &pid);
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!process)
            return {};
        wchar_t buffer[32768]{};
        DWORD size = 32768;
        const bool ok = QueryFullProcessImageNameW(process, 0, buffer, &size);
        CloseHandle(process);
        if (!ok)
            return {};
        const auto path = QString::fromWCharArray(buffer, int(size));
        return path.section('\\', -1);
    }
    QRect caretRect() const override {
        GUITHREADINFO info{sizeof(GUITHREADINFO)};
        if (!GetGUIThreadInfo(GetWindowThreadProcessId(GetForegroundWindow(), nullptr), &info) || !info.hwndCaret)
            return {};
        POINT at{info.rcCaret.left, info.rcCaret.bottom};
        if (!ClientToScreen(info.hwndCaret, &at))
            return {};
        MONITORINFOEXW monitor{};
        monitor.cbSize = sizeof(monitor);
        if (GetMonitorInfoW(MonitorFromPoint(at, MONITOR_DEFAULTTONEAREST), &monitor)) {
            for (auto *screen : QGuiApplication::screens())
                if (screen->name() == QString::fromWCharArray(monitor.szDevice)) {
                    const auto origin = screen->geometry().topLeft();
                    const auto ratio = screen->devicePixelRatio();
                    return QRect(origin.x() + qRound((at.x - monitor.rcMonitor.left) / ratio),
                                 origin.y() + qRound((at.y - monitor.rcMonitor.top) / ratio), 1, 1);
                }
        }
        return QRect(at.x, at.y, qMax(1L, info.rcCaret.right - info.rcCaret.left), 1);
    }
    bool erase(quintptr saved, int count, QString *error) override {
        if (!saved || target() != saved || count < 0 || count > 100000) {
            *error = "焦点已变化，未替换文字";
            return false;
        }
        for (int key : {VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN})
            if (GetAsyncKeyState(key) & 0x8000) {
                *error = "请松开修饰键后重试";
                return false;
            }
        for (int at = 0; at < count; at += 100) {
            if (target() != saved) {
                *error = "焦点已变化，已停止替换";
                return false;
            }
            QVector<INPUT> events;
            for (int i = 0; i < qMin(100, count - at); ++i) {
                INPUT event{};
                event.type = INPUT_KEYBOARD;
                event.ki.wVk = VK_BACK;
                events.append(event);
                event.ki.dwFlags = KEYEVENTF_KEYUP;
                events.append(event);
            }
            if (SendInput(UINT(events.size()), events.data(), sizeof(INPUT)) != UINT(events.size())) {
                *error = "文字替换被目标应用阻止";
                return false;
            }
        }
        return true;
    }
    bool paste(quintptr saved, QString *error) override {
        if (!saved || target() != saved) {
            *error = "焦点已变化，请手动粘贴";
            return false;
        }
        for (int key : {VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN})
            if (GetAsyncKeyState(key) & 0x8000) {
                *error = "请松开修饰键后重试";
                return false;
            }
        INPUT events[4]{};
        for (auto &e : events)
            e.type = INPUT_KEYBOARD;
        events[0].ki.wVk = VK_CONTROL;
        events[1].ki.wVk = 'V';
        events[2].ki.wVk = 'V';
        events[2].ki.dwFlags = KEYEVENTF_KEYUP;
        events[3].ki.wVk = VK_CONTROL;
        events[3].ki.dwFlags = KEYEVENTF_KEYUP;
        if (SendInput(4, events, sizeof(INPUT)) != 4) {
            *error = "粘贴被目标应用阻止";
            return false;
        }
        return true;
    }
    ~WindowsPlatform() override {
        if (m_hookThread.joinable()) {
            PostThreadMessageW(m_hookThreadId, WM_QUIT, 0, 0);
            m_hookThread.join();
        }
        instance = nullptr;
    }
    bool start(QString *error) override {
        if (m_hookThread.joinable())
            return true;
        instance = this;
        std::promise<DWORD> started;
        auto ready = started.get_future();
        m_hookThread = std::thread([this, signal = std::move(started)]() mutable {
            m_hookThreadId = GetCurrentThreadId();
            MSG message{};
            // Create the queue before publishing readiness, including on failure.
            PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
            keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, GetModuleHandleW(nullptr), 0);
            const DWORD keyboardError = keyboard ? ERROR_SUCCESS : GetLastError();
            mouse = SetWindowsHookExW(WH_MOUSE_LL, mouseProc, GetModuleHandleW(nullptr), 0);
            const DWORD mouseError = mouse ? ERROR_SUCCESS : GetLastError();
            const DWORD status = keyboard && mouse ? ERROR_SUCCESS
                                                   : (keyboardError ? keyboardError
                                                      : mouseError  ? mouseError
                                                                    : ERROR_GEN_FAILURE);
            signal.set_value(status);
            // Windows waits for low-level hooks. Never make that wait depend on
            // the QML/render synchronization or model loading on the GUI thread.
            // Only trigger events are queued back to the application thread.
            if (status == ERROR_SUCCESS)
                while (GetMessageW(&message, nullptr, 0, 0) > 0) {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            if (keyboard)
                UnhookWindowsHookEx(keyboard);
            if (mouse)
                UnhookWindowsHookEx(mouse);
            keyboard = mouse = nullptr;
        });
        const DWORD status = ready.get();
        if (status != ERROR_SUCCESS) {
            m_hookThread.join();
            *error = QString("Cannot register input hooks (%1)").arg(status);
            return false;
        }
        setProperty("nativeHookThreadId", quint32(m_hookThreadId.load()));
        return true;
    }
    bool inputSupported() const override { return true; }
    quintptr target() const override { return reinterpret_cast<quintptr>(GetForegroundWindow()); }
    bool fullscreen() const override {
        const HWND window = GetForegroundWindow();
        if (!window)
            return false;
        RECT client{};
        MONITORINFO monitor{sizeof(MONITORINFO)};
        if (!GetClientRect(window, &client) ||
            !GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor))
            return false;
        POINT a{client.left, client.top}, b{client.right, client.bottom};
        if (!ClientToScreen(window, &a) || !ClientToScreen(window, &b))
            return false;
        wchar_t name[128]{};
        GetClassNameW(window, name, 128);
        const auto &r = monitor.rcMonitor;
        return coversMonitor(QRect(a.x, a.y, b.x - a.x, b.y - a.y),
                             QRect(r.left, r.top, r.right - r.left, r.bottom - r.top), QString::fromWCharArray(name));
    }
    bool inject(quintptr saved, const QString &text, QString *error) override {
        const HWND window = reinterpret_cast<HWND>(saved);
        DWORD pid = 0;
        GetWindowThreadProcessId(window, &pid);
        if (!window || !IsWindow(window) || GetForegroundWindow() != window || pid == GetCurrentProcessId()) {
            *error = "Focus changed. Copy the result to insert it.";
            return false;
        }
        // Never type while a physical modifier is held, or steal focus back.
        for (int key : {VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN})
            if (GetAsyncKeyState(key) & 0x8000) {
                *error = "Release modifier keys, then copy the result.";
                return false;
            }
        QVector<INPUT> events;
        events.reserve(text.size() * 2);
        for (QChar ch : text) {
            INPUT down{};
            down.type = INPUT_KEYBOARD;
            down.ki.wScan = ch.unicode();
            down.ki.dwFlags = KEYEVENTF_UNICODE;
            events.append(down);
            down.ki.dwFlags |= KEYEVENTF_KEYUP;
            events.append(down);
        }
        if (SendInput(UINT(events.size()), events.data(), sizeof(INPUT)) != UINT(events.size())) {
            *error = "Text input was blocked by the target application. Copy the result instead.";
            return false;
        }
        return true;
    }
};
std::unique_ptr<Platform> createPlatform() {
    return std::make_unique<WindowsPlatform>();
}
