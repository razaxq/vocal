"""Check optional sentence inference in a ZIP without Qt/compiler SDK PATH."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

p = argparse.ArgumentParser()
p.add_argument('--zip', type=Path, required=True)
p.add_argument('--models', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
env = os.environ.copy()
env['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
for key in list(env):
    if key.startswith(('QT_', 'QML')):
        del env[key]
env['QSG_RHI_BACKEND'] = 'software'
env['QT_QUICK_BACKEND'] = 'software'
with tempfile.TemporaryDirectory(prefix='vocal-sentence-package-') as folder:
    stage = Path(folder)
    with zipfile.ZipFile(args.zip) as archive:
        assert not any(n.endswith(('.gguf', '.onnx', '.py')) for n in archive.namelist())
        archive.extractall(stage)
    assert (stage / 'licenses/llama-MIT.txt').is_file()
    assert (stage / 'licenses/llama-notices/vendor-hash-xxhash-LICENSE').is_file()
    app = stage / 'vocal-native.exe'
    run = subprocess.run([str(app), '--correction-worker', '--model-id', 'cec3-4b-q4',
        '--model-dir', str(args.models.resolve())], env=env, cwd=stage,
        input=json.dumps(dict(type='correct', id=1, text='我已经已经完成了今天的工作。'), ensure_ascii=False)+'\n',
        capture_output=True, encoding='utf8', timeout=100)
    (args.output / 'worker.log').write_text(run.stdout + run.stderr, encoding='utf8')
    assert run.returncode == 0, run.stderr
    events = [json.loads(s) for s in run.stdout.splitlines() if s.startswith('{')]
    assert events[-1]['text'] == '我已经完成了今天的工作。', events
    for language in ('zh', 'en'):
        data = stage / language
        data.mkdir()
        (data / 'settings.json').write_text(json.dumps(dict(correctionModel='cec3-4b-q4', language=language,
            modelId='paraformer-yue-offline', streamingModel='none', autoUpdate=False, dictionaryAutoUpdate=False)), encoding='utf8')
        run = subprocess.run([str(app), '--model-dir', str(args.models.resolve()), '--data-dir', str(data),
            '--smoke-page', '2', '--smoke-test', str((args.output / f'correction-{language}.png').resolve())],
            env=env, cwd=stage, capture_output=True, encoding='utf8', timeout=45)
        (args.output / f'ui-{language}.log').write_text(run.stdout + run.stderr, encoding='utf8')
        assert run.returncode == 0, (run.returncode, run.stderr)
        assert not any(s in run.stderr for s in ('ReferenceError', 'TypeError', 'Binding loop', 'Unable to assign')), run.stderr
print('PASS standalone ZIP: no model bundled, licenses, sentence worker, Chinese/English settings')
