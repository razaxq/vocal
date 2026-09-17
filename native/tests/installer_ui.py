"""Exercise real NSIS pages with a harmless payload and no registry writes."""
import argparse
import ctypes
from ctypes import wintypes as w
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--nsis', required=True)
    parser.add_argument('--compiler', required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    user = ctypes.windll.user32
    callback = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    user.EnumWindows.argtypes = [callback, w.LPARAM]
    user.EnumChildWindows.argtypes = [w.HWND, callback, w.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
    user.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user.SendMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user.SendMessageW.restype = w.LPARAM
    user.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM,
                                        w.UINT, w.UINT, ctypes.POINTER(ctypes.c_size_t)]
    user.IsWindowEnabled.argtypes = [w.HWND]
    user.IsWindowVisible.argtypes = [w.HWND]
    user.SetProcessDPIAware()
    user.GetDlgItem.argtypes = [w.HWND, ctypes.c_int]
    user.GetDlgItem.restype = w.HWND
    user.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    user.GetClientRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    user.MapWindowPoints.argtypes = [w.HWND, w.HWND, ctypes.POINTER(w.POINT), w.UINT]
    user.IsIconic.argtypes = [w.HWND]
    user.ShowWindow.argtypes = [w.HWND, ctypes.c_int]
    user.GetDC.argtypes = [w.HWND]
    user.GetDC.restype = w.HDC
    user.ReleaseDC.argtypes = [w.HWND, w.HDC]
    user.PrintWindow.argtypes = [w.HWND, w.HDC, w.UINT]
    user.GetParent.argtypes = [w.HWND]
    user.GetParent.restype = w.HWND
    gdi = ctypes.windll.gdi32
    gdi.CreateCompatibleDC.argtypes = [w.HDC]
    gdi.CreateCompatibleDC.restype = w.HDC
    gdi.CreateCompatibleBitmap.argtypes = [w.HDC, ctypes.c_int, ctypes.c_int]
    gdi.CreateCompatibleBitmap.restype = w.HBITMAP
    gdi.SelectObject.argtypes = [w.HDC, w.HANDLE]
    gdi.SelectObject.restype = w.HANDLE
    gdi.GetPixel.argtypes = [w.HDC, ctypes.c_int, ctypes.c_int]
    gdi.GetPixel.restype = w.DWORD
    gdi.DeleteObject.argtypes = [w.HANDLE]
    gdi.DeleteDC.argtypes = [w.HDC]

    def button_background(handle):
        parent = user.GetParent(handle)
        rect, child = w.RECT(), w.RECT()
        user.GetWindowRect(parent, ctypes.byref(rect))
        user.GetWindowRect(handle, ctypes.byref(child))
        screen = user.GetDC(parent)
        memory = gdi.CreateCompatibleDC(screen)
        bitmap = gdi.CreateCompatibleBitmap(screen, rect.right - rect.left, rect.bottom - rect.top)
        previous = gdi.SelectObject(memory, bitmap)
        try:
            assert user.PrintWindow(parent, memory, 0), 'Could not render installer'
            return gdi.GetPixel(memory, child.left - rect.left + 2,
                                (child.top + child.bottom) // 2 - rect.top)
        finally:
            gdi.SelectObject(memory, previous)
            gdi.DeleteObject(bitmap)
            gdi.DeleteDC(memory)
            user.ReleaseDC(parent, screen)

    def wait_for(predicate):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            result = predicate()
            if result:
                return result
            time.sleep(0.05)
        raise AssertionError('Installer UI timed out')

    def window_text(handle):
        text = ctypes.create_unicode_buffer(2048)
        user.GetWindowTextW(handle, text, len(text))
        return text.value

    def find(pid, caption=None, parent=None, required_control=None, visible=False):
        found = []

        @callback
        def inspect(handle, _):
            owner = w.DWORD()
            user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
            title = ctypes.create_unicode_buffer(1024)
            user.GetWindowTextW(handle, title, len(title))
            if (owner.value == pid and (not visible or user.IsWindowVisible(handle)) and (caption is None or title.value == caption)
                    and (required_control is None or user.GetDlgItem(handle, required_control))):
                found.append(handle)
            return True

        if parent:
            user.EnumChildWindows(parent, inspect, 0)
        else:
            user.EnumWindows(inspect, 0)
        return found[0] if found else None

    with tempfile.TemporaryDirectory(prefix='installer-ui-', dir=repo / 'data') as temp:
        root = Path(temp)
        subprocess.run(['powershell', '-NoProfile', '-File',
                        str(repo / 'native/scripts/installer-frame.ps1'),
                        '-Toolchain', str(Path(args.compiler).parent),
                        '-OutputDirectory', str(root / 'frame')], check=True)
        source = root / 'app.cpp'
        source.write_text(r'''
#include <windows.h>
#include <string>
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    wchar_t path[32768]; GetModuleFileNameW(nullptr, path, 32768);
    std::wstring marker = std::wstring(path) + L".started";
    auto file = CreateFileW(marker.c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 1;
    CloseHandle(file); return 0;
}
''', encoding='utf-8')
        payload = root / 'fixture.exe'
        subprocess.run([args.compiler, str(source), '-municode', '-mwindows', '-static',
                        '-o', str(payload)], check=True)
        production = (repo / 'native/installer/windows.nsi').read_text(encoding='utf-8')
        production = production[:production.index('Section "Vocal"')]
        production = production.replace('${__FILEDIR__}', str(repo / 'native/installer'))
        production = production.replace('InstallDirRegKey HKCU "Software\\VocalNative" "InstallDir"', '')
        production = production.replace('!insertmacro MUI_UNPAGE_CONFIRM', '')
        production = production.replace('!insertmacro MUI_UNPAGE_INSTFILES', '')
        for language, launch, complete_via in [(2052, True, 'finish'), (1033, False, 'finish'),
                                               (2052, True, 'close'), (1033, False, 'close')]:
            target = root / f'Install path 中文 {language} {complete_via}'
            script = root / f'{language}.nsi'
            installer = root / f'{language}.exe'
            text = production.replace('StrCpy $AppUpdate 0', f'StrCpy $AppUpdate 0\n    StrCpy $LANGUAGE {language}')
            text += f'''Section "Vocal"
    SetOutPath "$INSTDIR"
    File /oname=vocal-native.exe "{payload}"
    DetailPrint "Fixture payload installed"
    Sleep 600
SectionEnd
'''
            script.write_text(text, encoding='utf-8')
            subprocess.run([args.nsis, '/V2', '/INPUTCHARSET', 'UTF8', '/DVERSION=1.0.2',
                            '/DPRODUCT_VERSION=1.0.2', f'/DOUTPUT={installer}',
                            f'/DINSTALLER_FRAME={root / "frame/installer-frame.dll"}', str(script)], check=True)
            process = subprocess.Popen(f'"{installer}" /D={target}')
            try:
                window = wait_for(lambda: find(process.pid, required_control=0x7102))
                install = '安装' if language == 2052 else 'Install'
                button = wait_for(lambda: find(process.pid, install, window))
                bounds, client = w.RECT(), w.RECT()
                user.GetWindowRect(window, ctypes.byref(bounds))
                user.GetClientRect(window, ctypes.byref(client))
                assert bounds.bottom - bounds.top == client.bottom, 'Stock caption still present'
                point = ((bounds.top + 12) & 0xffff) << 16 | ((bounds.left + 12) & 0xffff)
                assert user.SendMessageW(window, 0x84, 0, point) == 2, 'Title bar cannot drag'
                user.SendMessageW(user.GetDlgItem(window, 0x7102), 0xF5, 0, 0)
                wait_for(lambda: user.IsIconic(window))
                user.ShowWindow(window, 9)  # SW_RESTORE
                for control_id in (0x7101, 0x7102):
                    title_button = user.GetDlgItem(window, control_id)
                    user.SendMessageW(window, 0x28, title_button, 1)
                    user.SendMessageW(title_button, 0x2A3, 0, 0)  # WM_MOUSELEAVE
                    user.SendMessageW(title_button, 0xF3, 1, 0)  # BM_SETSTATE pressed
                    pressed_color = 0x6c6cf5 if control_id == 0x7101 else 0xf3f0ee
                    assert button_background(title_button) == pressed_color, 'Pressed feedback missing'
                    user.SendMessageW(title_button, 0xF3, 0, 0)
                    color = button_background(title_button)
                    assert color == 0xffffff, f'Focus left title button highlighted: {color:#x}'
                assert find(process.pid, str(target), window), 'Installation directory lost'
                # Real shell picker: cancel, change to a Unicode/spaced directory,
                # then reopen/cancel. All shell work must be on a separate thread.
                change = find(process.pid, '更改位置' if language == 2052 else 'Change folder', window)
                folder_title = '选择 Vocal 的安装文件夹' if language == 2052 else 'Choose the Vocal installation folder'
                for select in (False, True, False):
                    user.PostMessageW(change, 0xF5, 0, 0)
                    wait_for(lambda: not user.IsWindowEnabled(button))
                    picker = wait_for(lambda: find(process.pid, folder_title, visible=True))
                    assert user.GetWindowThreadProcessId(picker, None) != user.GetWindowThreadProcessId(window, None)
                    reply = ctypes.c_size_t()
                    assert user.SendMessageTimeoutW(window, 0, 0, 0, 2, 250, ctypes.byref(reply)), 'Installer UI blocked by picker'
                    if select:
                        target = root / f'Changed 目录 {language} {complete_via}'
                        target.mkdir()
                        edit = wait_for(lambda: user.GetDlgItem(picker, 1152))
                        value = ctypes.create_unicode_buffer(str(target))
                        user.SendMessageW(edit, 0xC, 0, ctypes.addressof(value))
                    if select:
                        # Enter first navigates into the typed folder; a second
                        # confirmation chooses it, just like the native picker UI.
                        user.PostMessageW(picker, 0x111, 1, 0)
                        wait_for(lambda: not window_text(edit))
                    started = time.monotonic()
                    user.PostMessageW(picker, 0x111, 1 if select else 2, 0)
                    def restored():
                        assert user.SendMessageTimeoutW(window, 0, 0, 0, 2, 250, ctypes.byref(reply)), 'UI blocked after folder selection'
                        return user.IsWindowEnabled(button) and find(process.pid, '更改位置' if language == 2052 else 'Change folder', window)
                    wait_for(restored)
                    elapsed = time.monotonic() - started
                    assert elapsed < 1.0, f'Folder result stalled UI for {elapsed:.2f}s'
                    assert find(process.pid, str(target), window), 'Selected directory not applied/cancel lost directory'
                    print(f'PASS: folder select={select}, UI restored in {elapsed:.3f}s', flush=True)
                if language == 1033:
                    # Keep the primary button keyboard-operable after styling.
                    user.SendMessageW(window, 0x28, button, 1)  # WM_NEXTDLGCTL
                    user.PostMessageW(button, 0x100, 0x20, 0)  # Space down/up
                    user.PostMessageW(button, 0x101, 0x20, 0)
                else:
                    user.PostMessageW(button, 0xF5, 0, 0)  # Actual custom button.
                progress = '正在安装 Vocal' if language == 2052 else 'Installing Vocal'
                wait_for(lambda: find(process.pid, progress, window))
                # Closing during file replacement must remain disabled.
                user.SendMessageW(user.GetDlgItem(window, 0x7101), 0xF5, 0, 0)
                finish = '完成' if language == 2052 else 'Finish'
                button = wait_for(lambda: find(process.pid, finish, window))
                user.GetWindowRect(button, ctypes.byref(bounds))
                points = (w.POINT * 2)(w.POINT(bounds.left, bounds.top), w.POINT(bounds.right, bounds.bottom))
                user.MapWindowPoints(None, window, points, 2)
                assert abs(points[0].x - (client.right - points[1].x)) <= 1, 'Finish button margins differ'
                toggle = find(process.pid, '打开 Vocal' if language == 2052 else 'Open Vocal', window)
                assert toggle and user.SendMessageW(toggle, 0xF0, 0, 0) == 1
                # Exercise actual toggle input, not BM_SETCHECK: custom painting
                # must preserve both mouse and keyboard activation semantics.
                user.SendMessageW(toggle, 0xF5, 0, 0)
                assert user.SendMessageW(toggle, 0xF0, 0, 0) == 0
                user.SendMessageW(window, 0x28, toggle, 1)
                user.PostMessageW(toggle, 0x100, 0x20, 0)
                user.PostMessageW(toggle, 0x101, 0x20, 0)
                wait_for(lambda: user.SendMessageW(toggle, 0xF0, 0, 0) == 1)
                if not launch:
                    user.SendMessageW(toggle, 0xF5, 0, 0)
                user.PostMessageW(button if complete_via == 'finish' else user.GetDlgItem(window, 0x7101), 0xF5, 0, 0)
                assert process.wait(timeout=10) == 0
                assert (target / 'vocal-native.exe').exists()
                marker = target / 'vocal-native.exe.started'
                if launch:
                    wait_for(marker.exists)
                else:
                    assert not marker.exists(), 'Unchecked launch still started the app'
                print(f'PASS: language={language}, focus colors, drag/minimize, equal margins, {complete_via}, launch={launch}', flush=True)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()

        # The custom close button must still invoke NSIS cancellation, and must
        # not install anything while exiting from the first page.
        for exit_via in ('close', 'escape', 'alt-f4'):
            cancelled = root / f'cancelled-{exit_via}'
            process = subprocess.Popen(f'"{installer}" /D={cancelled}')
            try:
                window = wait_for(lambda: find(process.pid, required_control=0x7101))
                if exit_via == 'close':
                    user.PostMessageW(user.GetDlgItem(window, 0x7101), 0xF5, 0, 0)
                elif exit_via == 'escape':
                    user.PostMessageW(window, 0x100, 0x1B, 0)
                else:
                    user.PostMessageW(window, 0x112, 0xF060, 0)  # SC_CLOSE (Alt+F4)
                assert process.wait(timeout=5) == 1, 'Exit did not complete without confirmation'
                assert not cancelled.exists()
                print(f'PASS: {exit_via} exits directly before installation', flush=True)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()


if __name__ == '__main__':
    main()
