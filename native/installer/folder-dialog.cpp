// Shell extensions and folder enumeration must never run on the NSIS UI thread.
#include <windows.h>
#include <shobjidl.h>

namespace {
using Resolver = decltype(&GetProcAddress);
using Modules = decltype(&GetModuleHandleW);
Resolver resolve;
Modules module;
volatile LONG state; // 0 idle, 1 choosing, 2 selected, 3 cancelled, 4 failed
constexpr int capacity = 1024; // Matches the Unicode NSIS string buffer.
wchar_t selected[capacity];
struct Request { HWND owner; wchar_t title[capacity], initial[capacity]; };
decltype(&HeapFree) freeHeap;
HANDLE heap;
decltype(&SetWindowLongW) setWindowLong;
decltype(&CallWindowProcW) callWindowProc;
decltype(&SetPropW) setProp;
decltype(&GetPropW) getProp;
decltype(&ShowWindow) showWindow;
decltype(&CoTaskMemFree) releaseMemory;

bool copy(wchar_t *dest, const wchar_t *source, int count) {
    for (int i = 0; i < count; ++i) {
        dest[i] = source[i];
        if (!source[i]) return true;
    }
    dest[0] = 0;
    return false;
}

struct DialogEvents final : IFileDialogEvents {
    bool published = false;
    HWND window = nullptr;
    WNDPROC original = nullptr;
    void publish(LONG result) {
        if (published) return;
        published = true;
        __atomic_store_n(&state, result, __ATOMIC_RELEASE);
    }
    static LRESULT CALLBACK procedure(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        auto *self = static_cast<DialogEvents *>(getProp(hwnd, L"Vocal.FolderDialog"));
        if (!self) return 0;
        // Let Shell finish closing in its own thread after the visible dialog
        // has gone. Network providers/extensions can delay Show's return.
        if (msg == WM_CLOSE || (msg == WM_COMMAND && LOWORD(wp) == IDCANCEL)
            || (msg == WM_SYSCOMMAND && (wp & 0xfff0) == SC_CLOSE)) {
            showWindow(hwnd, SW_HIDE);
            self->publish(3);
        }
        if (msg == WM_DESTROY) self->publish(3);
        return callWindowProc(self->original, hwnd, msg, wp, lp);
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void **out) override {
        constexpr GUID unknown{0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
        constexpr GUID events{0x973510db,0x7d7f,0x452b,{0x89,0x75,0x74,0xa8,0x58,0x28,0xd3,0x54}};
        auto equal = [](const GUID &a, const GUID &b) {
            if (a.Data1 != b.Data1 || a.Data2 != b.Data2 || a.Data3 != b.Data3) return false;
            for (int i = 0; i < 8; ++i) if (a.Data4[i] != b.Data4[i]) return false;
            return true;
        };
        *out = nullptr;
        if (!equal(id, unknown) && !equal(id, events)) return E_NOINTERFACE;
        *out = static_cast<IFileDialogEvents *>(this);
        return S_OK;
    }
    // The worker owns this object until Unadvise and dialog destruction.
    ULONG STDMETHODCALLTYPE AddRef() override { return 2; }
    ULONG STDMETHODCALLTYPE Release() override { return 1; }
    HRESULT STDMETHODCALLTYPE OnFileOk(IFileDialog *dialog) override {
        if (published) return S_FALSE;
        IShellItem *item = nullptr;
        PWSTR path = nullptr;
        LONG result = 4;
        if (SUCCEEDED(dialog->GetResult(&item))
            && SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))
            && copy(selected, path, capacity)) result = 2;
        if (window) showWindow(window, SW_HIDE);
        publish(result);
        if (path) releaseMemory(path);
        if (item) item->Release();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnFolderChange(IFileDialog *dialog) override {
        if (window) return S_OK;
        constexpr GUID oleWindow{0x00000114,0,0,{0xc0,0,0,0,0,0,0,0x46}};
        IOleWindow *native = nullptr;
        if (SUCCEEDED(dialog->QueryInterface(oleWindow, reinterpret_cast<void **>(&native)))) {
            native->GetWindow(&window);
            native->Release();
            if (window && setProp(window, L"Vocal.FolderDialog", this))
                original = reinterpret_cast<WNDPROC>(setWindowLong(window, GWLP_WNDPROC,
                    reinterpret_cast<LONG>(procedure)));
            else window = nullptr;
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnFolderChanging(IFileDialog *, IShellItem *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnSelectionChange(IFileDialog *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnShareViolation(IFileDialog *, IShellItem *, FDE_SHAREVIOLATION_RESPONSE *r) override {
        *r = FDESVR_DEFAULT; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnTypeChange(IFileDialog *) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnOverwrite(IFileDialog *, IShellItem *, FDE_OVERWRITE_RESPONSE *r) override {
        *r = FDEOR_DEFAULT; return S_OK;
    }
};

DWORD WINAPI choose(void *data) {
    auto *request = static_cast<Request *>(data);
    auto load = reinterpret_cast<decltype(&LoadLibraryW)>(resolve(module(L"kernel32.dll"), "LoadLibraryW"));
    // Keep system DLLs loaded: another selection may start during COM cleanup.
    HMODULE ole = module(L"ole32.dll");
    if (!ole) ole = load(L"ole32.dll");
    HMODULE shell = module(L"shell32.dll");
    if (!shell) shell = load(L"shell32.dll");
    auto init = reinterpret_cast<decltype(&CoInitializeEx)>(resolve(ole, "CoInitializeEx"));
    auto uninit = reinterpret_cast<decltype(&CoUninitialize)>(resolve(ole, "CoUninitialize"));
    auto create = reinterpret_cast<decltype(&CoCreateInstance)>(resolve(ole, "CoCreateInstance"));
    auto release = reinterpret_cast<decltype(&CoTaskMemFree)>(resolve(ole, "CoTaskMemFree"));
    using Parse = HRESULT (WINAPI *)(PCWSTR, IBindCtx *, REFIID, void **);
    auto parse = reinterpret_cast<Parse>(resolve(shell, "SHCreateItemFromParsingName"));
    const HMODULE user = module(L"user32.dll");
    auto createWindow = reinterpret_cast<decltype(&CreateWindowExW)>(resolve(user, "CreateWindowExW"));
    auto destroyWindow = reinterpret_cast<decltype(&DestroyWindow)>(resolve(user, "DestroyWindow"));
    auto bounds = reinterpret_cast<decltype(&GetWindowRect)>(resolve(user, "GetWindowRect"));
    // Keep the modal owner and input queue on this STA. Cross-thread ownership
    // attaches input queues, defeating the isolation during shell teardown.
    RECT rect{0, 0, 500, 700};
    bounds(request->owner, &rect);
    HWND owner = createWindow(WS_EX_TOOLWINDOW, L"STATIC", L"", WS_POPUP,
        rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top,
        nullptr, nullptr, nullptr, nullptr);
    LONG result = 4;
    IFileOpenDialog *dialog = nullptr;
    IShellItem *folder = nullptr, *item = nullptr;
    PWSTR path = nullptr;
    DialogEvents events;
    DWORD cookie = 0;
    bool advised = false;
    const bool initialized = init && uninit && SUCCEEDED(init(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE));
    constexpr GUID clsid{0xdc1c5a9c, 0xe88a, 0x4dde, {0xa5,0xa1,0x60,0xf8,0x2a,0x20,0xae,0xf7}};
    constexpr GUID iid{0xd57c7288, 0xd4ad, 0x4768, {0xbe,0x02,0x9d,0x96,0x95,0x32,0xd9,0x60}};
    constexpr GUID shellIid{0x43826d1e, 0xe718, 0x42ee, {0xbc,0x55,0xa1,0xe2,0x61,0xc3,0x7b,0xfe}};
    if (owner && initialized && create && parse && release
        && SUCCEEDED(create(clsid, nullptr, CLSCTX_INPROC_SERVER, iid, reinterpret_cast<void **>(&dialog)))) {
        dialog->SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
        dialog->SetTitle(request->title);
        advised = SUCCEEDED(dialog->Advise(&events, &cookie));
        // New installations often start at a folder that does not exist yet.
        // Find the nearest existing parent without querying the UI thread.
        while (request->initial[0]) {
            if (SUCCEEDED(parse(request->initial, nullptr, shellIid, reinterpret_cast<void **>(&folder)))) break;
            int last = -1;
            for (int i = 0; request->initial[i]; ++i) if (request->initial[i] == L'\\') last = i;
            if (last < 3) break;
            request->initial[last] = 0;
        }
        if (folder) dialog->SetFolder(folder);
        const HRESULT shown = dialog->Show(owner);
        if (shown == HRESULT_FROM_WIN32(ERROR_CANCELLED)) result = 3;
        else if (!events.published && SUCCEEDED(shown) && SUCCEEDED(dialog->GetResult(&item))
            && SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))
            && copy(selected, path, capacity)) result = 2;
    }
    // NSIS can repaint/update the path before potentially slow shell cleanup.
    freeHeap(heap, 0, request);
    events.publish(result);
    if (path) release(path);
    if (item) item->Release();
    if (folder) folder->Release();
    if (advised) dialog->Unadvise(cookie);
    if (dialog) dialog->Release();
    if (owner) destroyWindow(owner);
    if (initialized) uninit();
    return 0;
}
}

void InitializeFolderPicker(Resolver resolver, Modules modules) {
    resolve = resolver;
    module = modules;
    const HMODULE kernel = module(L"kernel32.dll");
    heap = reinterpret_cast<decltype(&GetProcessHeap)>(resolve(kernel, "GetProcessHeap"))();
    freeHeap = reinterpret_cast<decltype(&HeapFree)>(resolve(kernel, "HeapFree"));
    const HMODULE user = module(L"user32.dll");
    setWindowLong = reinterpret_cast<decltype(setWindowLong)>(resolve(user, "SetWindowLongW"));
    callWindowProc = reinterpret_cast<decltype(callWindowProc)>(resolve(user, "CallWindowProcW"));
    setProp = reinterpret_cast<decltype(setProp)>(resolve(user, "SetPropW"));
    getProp = reinterpret_cast<decltype(getProp)>(resolve(user, "GetPropW"));
    showWindow = reinterpret_cast<decltype(showWindow)>(resolve(user, "ShowWindow"));
    auto load = reinterpret_cast<decltype(&LoadLibraryW)>(resolve(kernel, "LoadLibraryW"));
    releaseMemory = reinterpret_cast<decltype(releaseMemory)>(resolve(load(L"ole32.dll"), "CoTaskMemFree"));
}

extern "C" __declspec(dllexport) int __stdcall BeginFolderDialog(HWND owner, PCWSTR title, PCWSTR initial) {
    if (__atomic_load_n(&state, __ATOMIC_ACQUIRE)) return 0;
    const HMODULE kernel = module(L"kernel32.dll");
    auto allocate = reinterpret_cast<decltype(&HeapAlloc)>(resolve(kernel, "HeapAlloc"));
    auto start = reinterpret_cast<decltype(&CreateThread)>(resolve(kernel, "CreateThread"));
    auto close = reinterpret_cast<decltype(&CloseHandle)>(resolve(kernel, "CloseHandle"));
    auto *request = static_cast<Request *>(allocate(heap, 0, sizeof(Request)));
    if (!request) return 0;
    request->owner = owner;
    if (!copy(request->title, title, capacity) || !copy(request->initial, initial, capacity)) {
        freeHeap(heap, 0, request);
        return 0;
    }
    __atomic_store_n(&state, 1, __ATOMIC_RELEASE);
    HANDLE thread = start(nullptr, 0, choose, request, 0, nullptr);
    if (!thread) {
        freeHeap(heap, 0, request);
        __atomic_store_n(&state, 0, __ATOMIC_RELEASE);
        return 0;
    }
    close(thread);
    return 1;
}

extern "C" __declspec(dllexport) int __stdcall PollFolderDialog(PWSTR path, int count) {
    LONG result = __atomic_load_n(&state, __ATOMIC_ACQUIRE);
    if (result <= 1) return 0;
    if (result == 2 && !copy(path, selected, count)) result = 4;
    __atomic_store_n(&state, 0, __ATOMIC_RELEASE);
    return result;
}
