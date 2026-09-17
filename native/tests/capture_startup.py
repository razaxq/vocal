"""Compare the same public PCM captured before/after model readiness; no microphone or hooks."""
import argparse
import array
import json
import os
from pathlib import Path
import subprocess
import tempfile
import wave

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--models', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
app, models = args.app.resolve(), args.models.resolve()
os.environ['QT_MEDIA_BACKEND'] = 'windows'
fixture = models / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
with wave.open(str(fixture)) as source:
    assert source.getframerate() == 16000 and source.getnchannels() == 1
    pcm = array.array('f', (s / 32768 for s in array.array('h', source.readframes(source.getnframes())))).tobytes()
reports = []
for cold in (False, True):
    with tempfile.TemporaryDirectory(prefix='vocal-capture-startup-') as temp:
        data = Path(temp)
        (data / 'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False, autoUpdate=False,
            streamingModel='none', modelId='paraformer-yue-offline', correctionModel='macbert4csc')), encoding='utf8')
        (data / 'speech.f32').write_bytes(pcm)
        command = [str(app), '--data-dir', temp, '--model-dir', str(models), '--pipeline-test',
                   str(data / 'speech.f32'), '--pipeline-packet-ms', '20']
        if cold:
            command.append('--pipeline-cold-start')
        process = subprocess.run(command, capture_output=True, encoding='utf8', timeout=120)
        assert process.returncode == 0, (process.returncode, process.stdout, process.stderr)
        result = [json.loads(line) for line in process.stdout.splitlines() if line.startswith('{')][-1]
        assert result['text'] and not result['error'] and result['history'] == 1, result
        assert result['capturedWhileLoading'] == cold, result
        reports.append(dict(cold=cold, **result))
        print(f'PASS capture during model startup: cold={cold}', flush=True)
assert reports[0]['text'] == reports[1]['text'], reports
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf8')
print('PASS cold/warm transcript equality, including the beginning', flush=True)
