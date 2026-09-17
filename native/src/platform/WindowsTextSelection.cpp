#include "WindowsTextSelection.h"
#include <QScopeGuard>
#include <QTextBoundaryFinder>
#include <QVector>
#include <memory>
#include <uiautomation.h>

namespace {
enum class Selection { Selected, Unsupported, Failed };
struct ReleaseCom {
    template <class T> void operator()(T *pointer) const { if (pointer) pointer->Release(); }
};
template <class T> using Com = std::unique_ptr<T, ReleaseCom>;
HWND focusedControl(HWND window) {
    GUITHREADINFO info{sizeof(GUITHREADINFO)};
    if (GetForegroundWindow() != window || !GetGUIThreadInfo(GetWindowThreadProcessId(window, nullptr), &info))
        return nullptr;
    return info.hwndFocus;
}
bool message(HWND control, UINT id, WPARAM a, LPARAM b, DWORD_PTR &result) {
    return SendMessageTimeoutW(control, id, a, b, SMTO_ABORTIFHUNG | SMTO_BLOCK, 200, &result) != 0;
}
QString normalized(QString text) {
    return text.replace("\r\n", "\n").replace('\r', '\n');
}
int graphemes(const QString &text) {
    QTextBoundaryFinder finder(QTextBoundaryFinder::Grapheme, text);
    int count = 0;
    while (finder.toNextBoundary() >= 0) ++count;
    return count;
}
Selection nativeEdit(HWND window, HWND control, const QString &expected, bool select = true) {
    wchar_t name[128]{};
    GetClassNameW(control, name, 128);
    const auto type = QString::fromWCharArray(name);
    if (type.compare("Edit", Qt::CaseInsensitive) != 0)
        return Selection::Unsupported; // Other providers use UI Automation below.
    if (GetWindowLongPtrW(control, GWL_STYLE) & ES_PASSWORD)
        return Selection::Failed;
    DWORD_PTR result = 0;
    DWORD start = 0, end = 0;
    if (!message(control, EM_GETSEL, WPARAM(&start), LPARAM(&end), result) || start != end ||
        !message(control, WM_GETTEXTLENGTH, 0, 0, result))
        return Selection::Failed;
    if (result > 1024 * 1024)
        return Selection::Unsupported;
    std::wstring buffer(size_t(result) + 1, L'\0');
    if (!message(control, WM_GETTEXT, buffer.size(), LPARAM(buffer.data()), result))
        return Selection::Failed;
    const auto before = QString::fromWCharArray(buffer.data(), int(result));
    if (end > DWORD(before.size())) return Selection::Failed;
    int count = 0;
    for (const auto &candidate : {expected, normalized(expected).replace("\n", "\r\n")})
        if (!candidate.isEmpty() && before.first(end).endsWith(candidate)) {
            count = candidate.size();
            break;
        }
    if (!count || focusedControl(window) != control) return Selection::Failed;
    DWORD freshStart = 0, freshEnd = 0;
    if (!message(control, EM_GETSEL, WPARAM(&freshStart), LPARAM(&freshEnd), result) ||
        freshStart != start || freshEnd != end ||
        (select && !message(control, EM_SETSEL, end - count, end, result)))
        return Selection::Failed;
    return Selection::Selected;
}
Selection accessibleText(HWND window, const QString &expected, bool select = true) {
    const auto initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    const auto uninitialize = qScopeGuard([&] { if (SUCCEEDED(initialized)) CoUninitialize(); });
    if (FAILED(initialized) && initialized != RPC_E_CHANGED_MODE) return Selection::Unsupported;
    IUIAutomation *raw = nullptr;
    if (FAILED(CoCreateInstance(CLSID_CUIAutomation8, nullptr, CLSCTX_INPROC_SERVER,
                                IID_IUIAutomation, reinterpret_cast<void **>(&raw))))
        return Selection::Unsupported;
    Com<IUIAutomation> automation(raw);
    IUIAutomation2 *raw2 = nullptr;
    if (SUCCEEDED(raw->QueryInterface(IID_IUIAutomation2, reinterpret_cast<void **>(&raw2)))) {
        Com<IUIAutomation2> limits(raw2);
        limits->put_ConnectionTimeout(200);
        limits->put_TransactionTimeout(200);
    }
    IUIAutomationElement *elementRaw = nullptr;
    if (FAILED(automation->GetFocusedElement(&elementRaw)) || !elementRaw) return Selection::Unsupported;
    Com<IUIAutomationElement> element(elementRaw);
    BOOL password = FALSE;
    if (FAILED(element->get_CurrentIsPassword(&password)) || password) return Selection::Failed;
    IUIAutomationTextPattern *patternRaw = nullptr;
    if (FAILED(element->GetCurrentPatternAs(UIA_TextPatternId, IID_IUIAutomationTextPattern,
                                           reinterpret_cast<void **>(&patternRaw))) || !patternRaw)
        return Selection::Unsupported;
    Com<IUIAutomationTextPattern> pattern(patternRaw);
    IUIAutomationTextRangeArray *selectionRaw = nullptr;
    if (FAILED(pattern->GetSelection(&selectionRaw)) || !selectionRaw) return Selection::Failed;
    Com<IUIAutomationTextRangeArray> selection(selectionRaw);
    int length = 0;
    if (FAILED(selection->get_Length(&length)) || length != 1) return Selection::Failed;
    IUIAutomationTextRange *caretRaw = nullptr;
    if (FAILED(selection->GetElement(0, &caretRaw)) || !caretRaw) return Selection::Failed;
    Com<IUIAutomationTextRange> caret(caretRaw);
    int difference = 0;
    if (FAILED(caret->CompareEndpoints(TextPatternRangeEndpoint_Start, caret.get(),
                                       TextPatternRangeEndpoint_End, &difference)) || difference != 0)
        return Selection::Failed; // User selection is not ours to overwrite.
    // Providers differ in Unicode character units. Verify the exact text before
    // selecting, including surrogate pairs, grapheme clusters and line endings.
    QList<int> counts{graphemes(expected), int(expected.toUcs4().size()), int(expected.size()),
                      int(normalized(expected).replace("\n", "\r\n").size())};
    for (const int count : counts) {
        IUIAutomationTextRange *rangeRaw = nullptr;
        if (FAILED(caret->Clone(&rangeRaw)) || !rangeRaw) return Selection::Failed;
        Com<IUIAutomationTextRange> range(rangeRaw);
        int moved = 0;
        if (FAILED(range->MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -count, &moved)))
            return Selection::Failed;
        BSTR text = nullptr;
        if (FAILED(range->GetText(-1, &text))) return Selection::Failed;
        const auto actual = QString::fromWCharArray(text, int(SysStringLen(text)));
        SysFreeString(text);
        if (normalized(actual) != normalized(expected)) continue;
        IUIAutomationElement *currentRaw = nullptr;
        if (GetForegroundWindow() != window || FAILED(automation->GetFocusedElement(&currentRaw)) || !currentRaw)
            return Selection::Failed;
        Com<IUIAutomationElement> current(currentRaw);
        BOOL same = FALSE;
        if (FAILED(automation->CompareElements(element.get(), current.get(), &same)) || !same)
            return Selection::Failed;
        // Focus can stay in the same editor while the user moves its caret.
        IUIAutomationTextRangeArray *freshRaw = nullptr;
        if (FAILED(pattern->GetSelection(&freshRaw)) || !freshRaw) return Selection::Failed;
        Com<IUIAutomationTextRangeArray> fresh(freshRaw);
        IUIAutomationTextRange *freshCaretRaw = nullptr;
        if (FAILED(fresh->get_Length(&length)) || length != 1 ||
            FAILED(fresh->GetElement(0, &freshCaretRaw)) || !freshCaretRaw) return Selection::Failed;
        Com<IUIAutomationTextRange> freshCaret(freshCaretRaw);
        for (auto endpoint : {TextPatternRangeEndpoint_Start, TextPatternRangeEndpoint_End})
            if (FAILED(caret->CompareEndpoints(endpoint, freshCaret.get(), endpoint, &difference)) || difference != 0)
                return Selection::Failed;
        return !select || SUCCEEDED(range->Select()) ? Selection::Selected : Selection::Failed;
    }
    return Selection::Failed;
}
}

bool selectPreviousWindowsText(HWND window, const QString &expected, QString *error, QString *method) {
    const auto control = focusedControl(window);
    if (!window || !control || expected.isEmpty() || expected.size() > 200000) {
        *error = "焦点已变化，未替换文字";
        return false;
    }
    auto result = nativeEdit(window, control, expected);
    if (method) *method = "native-range";
    if (result == Selection::Unsupported) {
        if (method) *method = "uia-range";
        result = accessibleText(window, expected);
    }
    if (result == Selection::Selected) return true;
    if (result == Selection::Failed) {
        *error = "输入位置或文字已变化，结果已保留，可从历史中复制";
        return false;
    }
    // Custom editors without an accessible text range: one batch selects the
    // suffix. No Backspace/Delete and no Ctrl+A; paste will replace it once.
    if (focusedControl(window) != control) {
        *error = "焦点已变化，未替换文字";
        return false;
    }
    QVector<INPUT> events;
    if (method) *method = "keyboard-selection";
    auto key = [&](WORD value, bool up, bool extended = false) {
        INPUT input{};
        input.type = INPUT_KEYBOARD;
        input.ki.wVk = value;
        input.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
        events.append(input);
    };
    key(VK_LSHIFT, false);
    for (int i = 0, count = graphemes(expected); i < count; ++i) {
        key(VK_LEFT, false, true);
        key(VK_LEFT, true, true);
    }
    key(VK_LSHIFT, true);
    if (SendInput(UINT(events.size()), events.data(), sizeof(INPUT)) != UINT(events.size())) {
        INPUT release = events.last();
        SendInput(1, &release, sizeof(INPUT));
        *error = "目标应用阻止了文字选择，结果已保留";
        return false;
    }
    return true;
}

int previousWindowsTextMatches(HWND window, const QString &expected) {
    const auto control = focusedControl(window);
    if (!window || !control) return 0;
    if (expected.isEmpty()) return -1;
    auto result = nativeEdit(window, control, expected, false);
    if (result == Selection::Unsupported) result = accessibleText(window, expected, false);
    return result == Selection::Selected ? 1 : result == Selection::Unsupported ? -1 : 0;
}
