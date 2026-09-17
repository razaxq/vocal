"""Exercise production NSIS update callbacks in an isolated, registry-free fixture."""
import argparse
import ctypes
from ctypes import wintypes
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--nsis', required=True)
    parser.add_argument('--compiler', required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix='silent-update-', dir=repo / 'data') as temp:
        root = Path(temp)
        payload = root / 'payload'
        target = root / 'Install path 中文'
        payload.mkdir()
        target.mkdir()
        source = root / 'fixture.cpp'
        source.write_text(r'''
#include <windows.h>
#include <string>
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR args, int) {
    if (std::wstring(args) == L"--hold") { Sleep(4000); return 0; }
    wchar_t path[32768];
    GetModuleFileNameW(nullptr, path, 32768);
    std::wstring marker = std::wstring(path) + L".started";
    HANDLE file = CreateFileW(marker.c_str(), GENERIC_WRITE, 0, nullptr,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 1;
    CloseHandle(file);
    return 0;
}
''', encoding='utf-8')
        subprocess.run([args.compiler, str(source), '-municode', '-mwindows', '-static',
                        '-o', str(payload / 'vocal-native.exe')], check=True)
        shutil.copy2(payload / 'vocal-native.exe', target / 'vocal-native.exe')
        (payload / 'version.txt').write_text('new', encoding='utf-8')
        (target / 'version.txt').write_text('old', encoding='utf-8')

        # Reuse actual callbacks; replace ALL install/uninstall sections. This
        # fixture writes only to the temporary target: no registry or shortcuts.
        production = (repo / 'native/installer/windows.nsi').read_text(encoding='utf-8')
        callbacks = production[production.index('Function .onInit'):production.index('!define MUI_ICON')]
        installer = root / 'fixture-setup.exe'
        script = root / 'fixture.nsi'
        script.write_text('''Unicode true
RequestExecutionLevel user
Name "Vocal silent update fixture"
OutFile "''' + str(installer) + '''"
!include "FileFunc.nsh"
Var AppUpdate
Var WaitPid
''' + callbacks + '''
Section
    SetOutPath "$INSTDIR"
    File /r "''' + str(payload) + '''\\*"
SectionEnd
''', encoding='utf-8')
        subprocess.run([args.nsis, '/INPUTCHARSET', 'UTF8', '/V2', str(script)], check=True)

        # Keep the original executable locked while the installer starts.
        old = subprocess.Popen([str(target / 'vocal-native.exe'), '--hold'])
        command = f'"{installer}" /S /APPUPDATE /WAITPID={old.pid} /D={target}'
        update = subprocess.Popen(command)
        visible = []
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        @callback_type
        def inspect_window(handle, _):
            text = ctypes.create_unicode_buffer(256)
            ctypes.windll.user32.GetWindowTextW(handle, text, len(text))
            if ctypes.windll.user32.IsWindowVisible(handle) and 'Vocal silent update fixture' in text.value:
                visible.append(text.value)
            return True

        try:
            deadline = time.monotonic() + 25
            waited = False
            while update.poll() is None and time.monotonic() < deadline:
                ctypes.windll.user32.EnumWindows(inspect_window, 0)
                if old.poll() is None:
                    assert (target / 'version.txt').read_text() == 'old', 'Overwrote files before parent exited'
                    waited = True
                time.sleep(0.05)
            assert update.wait(timeout=5) == 0, 'Installer failed'
            assert waited, 'Did not exercise a live parent'
            assert not visible, f'Installer displayed UI: {visible}'
            assert (target / 'version.txt').read_text() == 'new', 'Wrong installation directory'
            marker = target / 'vocal-native.exe.started'
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            assert marker.exists(), 'Updated app did not restart'
            print('PASS: silent install, wait for parent, path with spaces/Unicode, restart')
        finally:
            for process in (old, update):
                if process.poll() is None:
                    process.kill()
                process.wait()


if __name__ == '__main__':
    main()
