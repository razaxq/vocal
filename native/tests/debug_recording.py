"""End-to-end debug capture and offline replay using public audio only."""
import argparse
import array
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import wave

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--models', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
app, models, output = args.app.resolve(), args.models.resolve(), args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
repo = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('replay_debug', repo / 'native/scripts/replay-debug.py')
replay_debug = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay_debug)
os.environ['QT_MEDIA_BACKEND'] = 'windows'
with wave.open(str(models / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav')) as wav:
    assert wav.getframerate() == 16000
    speech = array.array('f', (x / 32768 for x in array.array('h', wav.readframes(wav.getnframes()))))
reports = []
for case in ('disabled', 'enabled', 'silent'):
    data = output / case
    data.mkdir(exist_ok=True)
    settings = dict(debugRecording=case != 'disabled', dictionaryAutoUpdate=False, autoUpdate=False,
                    streamingModel='paraformer-zh-en' if case == 'enabled' else 'none',
                    llmApiKey='DEBUG_TEST_SECRET_NOT_FOR_LOGS', llmEnabled=False,
                    injectMode='preview', automaticSegmentation=True)
    (data / 'settings.json').write_text(json.dumps(settings), encoding='utf8')
    pcm = array.array('f', [0]) * 48000 if case == 'silent' else speech + array.array('f', [0]) * 6400 + speech
    path = data / 'input.f32'
    path.write_bytes(pcm.tobytes())
    process = subprocess.run([str(app), '--data-dir', str(data), '--model-dir', str(models),
        '--pipeline-test', str(path), '--pipeline-packet-ms', '100'], capture_output=True, encoding='utf8', timeout=180)
    assert process.returncode == 0, (process.stdout, process.stderr)
    result = [json.loads(x) for x in process.stdout.splitlines() if x.startswith('{')][-1]
    if case == 'disabled':
        assert not (data / 'debug').exists()
    else:
        sessions = sorted((data / 'debug').glob('*/session.json'))
        session = sessions[-1].parent
        meta = json.loads(sessions[-1].read_text(encoding='utf8'))
        rate, recorded = replay_debug.load_audio(session / 'audio.wav')
        assert rate == 16000 and recorded == pcm.tobytes(), (case, len(recorded), len(pcm) * 4)
        assert meta['summary']['text'] == result['text'], (meta, result)
        assert meta['status'] == ('empty' if case == 'silent' else 'completed'), meta
        events = [json.loads(x) for x in (session / 'events.jsonl').read_text(encoding='utf8').splitlines()]
        assert events[-1]['stage'] == 'session.end'
        assert [e['seq'] for e in events] == list(range(1, len(events) + 1))
        assert sum(e['samples'] for e in events if e['stage'] == 'capture.packet') == len(pcm)
        cuts = [e for e in events if e['stage'] == 'segment.cut']
        assert sum(e['samples'] for e in cuts) == len(pcm)
        for log in (session / 'session.json', session / 'events.jsonl'):
            assert 'DEBUG_TEST_SECRET_NOT_FOR_LOGS' not in log.read_text(encoding='utf8')
        if case == 'enabled':
            for role in ('offline', 'streaming', 'correction'):
                assert any(e['stage'] == 'worker.response' and e['worker'] == role
                           and e['message']['type'] == 'result' for e in events), role
            assert any(e['stage'] == 'punctuation.result' for e in events)
            assert any(e['stage'] == 'worker.response' and e['worker'] == 'offline'
                       and e['message'].get('decodeTrace') for e in events)
            assert any(e['stage'] == 'preview' and e['text'] for e in events)
            assert any(e['stage'] == 'output.request' and e['final'] for e in events)
            report = replay_debug.replay(session, app, models)
            assert all(r['sameText'] for rows in report['workers'].values() for r in rows), report
            (data / 'replay.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    reports.append(dict(case=case, **result))
    print(f'PASS {case}: complete audio, stage records, secret exclusion and local replay', flush=True)
(output / 'results.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf8')
