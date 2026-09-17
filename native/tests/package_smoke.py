"""Validate the shipped ZIP, versions, DLLs and QML without SDK PATH or models."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--dist', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
dist, output = args.dist.resolve(), args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
archives = list(dist.glob('Vocal-Native-*-win-x64.zip'))
assert len(archives) == 1, archives
for line in (dist / 'SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert Path(name).name == name
    assert hashlib.sha256((dist / name).read_bytes()).hexdigest() == digest, name

env = os.environ.copy()
env['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
for name in list(env):
    if name.startswith(('QT_', 'QML')):
        env.pop(name)
env['QSG_RHI_BACKEND'] = 'software'
env['QT_QUICK_BACKEND'] = 'software'

with tempfile.TemporaryDirectory(prefix='vocal-deployment-') as temp:
    directory = Path(temp)
    with zipfile.ZipFile(archives[0]) as archive:
        names = archive.namelist()
        assert all('..' not in Path(name).parts and not Path(name).is_absolute() for name in names)
        assert not any(name.lower().endswith(('.onnx', '.node', 'base.dict.yaml', 'electron.exe', 'node.exe')) for name in names)
        assert not any('node_modules' in name for name in names)
        archive.extractall(directory)
    marker = json.loads((directory / 'native-release.json').read_text(encoding='utf-8-sig'))
    version = marker['version']
    assert marker['channel'] == 'native'
    assert marker['development'] == version.endswith('-native-dev')
    assert (dist / f'Vocal-Native-Setup-{version}.exe').is_file()
    assert (directory / 'resources/dictionaries/rime-ice/catalog.json').is_file()
    assert (directory / 'licenses/LGPL-3.0-only.txt').is_file()
    assert (directory / 'plugins/platforms/qwindows.dll').is_file()
    assert not (directory / 'platforms').exists()
    app = directory / 'vocal-native.exe'

    def run(arguments, name):
        result = subprocess.run([str(app), *arguments], cwd=directory, env=env,
                                capture_output=True, encoding='utf-8', timeout=45)
        (output / f'{name}.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        assert result.returncode == 0, (name, result.returncode, result.stderr)
        assert not any(text in result.stderr for text in [
            'ReferenceError', 'TypeError', 'Binding loop', 'Unable to assign', 'failed to load component'
        ]), result.stderr
        return result

    assert run(['--version'], 'version').stdout.strip() == f'VocalNative {version}'
    for page in [0, 1, 8]:
        data = directory / f'check-{page}'
        data.mkdir()
        (data / 'settings.json').write_text(json.dumps({'dictionaryAutoUpdate': False, 'autoUpdate': False}))
        screenshot = output / f'page-{page}.png'
        run(['--data-dir', str(data), '--model-dir', str(directory / 'empty-models'),
             '--smoke-test', str(screenshot), '--smoke-ui-only', '--smoke-page', str(page)], f'page-{page}')
        assert screenshot.stat().st_size > 1000

    # Explicitly load the deployed inference ABI, not any SDK copy in PATH.
    with os.add_dll_directory(str(directory)):
        sherpa = ctypes.CDLL(str(directory / 'sherpa-onnx-c-api.dll'))
        sherpa.SherpaOnnxGetVersionStr.restype = ctypes.c_char_p
        sherpa_version = sherpa.SherpaOnnxGetVersionStr().decode()
        assert sherpa_version.lstrip('v') == '1.13.8', sherpa_version
        ort = ctypes.CDLL(str(directory / 'onnxruntime.dll'))
        class OrtApiBase(ctypes.Structure):
            _fields_ = [('get_api', ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_uint32)),
                        ('get_version', ctypes.WINFUNCTYPE(ctypes.c_char_p))]
        ort.OrtGetApiBase.restype = ctypes.POINTER(OrtApiBase)
        base = ort.OrtGetApiBase().contents
        assert base.get_api(20), 'Correction API version 20 is unavailable'
        ort_version = base.get_version().decode()
        # Release these handles so TemporaryDirectory can remove the DLLs on Windows.
        from _ctypes import FreeLibrary
        FreeLibrary(sherpa._handle)
        FreeLibrary(ort._handle)
    (output / 'deployment.json').write_text(json.dumps({
        'version': version, 'development': marker['development'],
        'sherpaVersion': sherpa_version, 'onnxRuntimeVersion': ort_version,
        'uiPages': [0, 1, 8], 'sdkPathRemoved': True
    }, indent=2), encoding='utf-8')
print(f'PASS deployment: {version}, isolated ZIP launch, QML, DLL ABI and SHA-256', flush=True)
