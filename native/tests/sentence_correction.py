"""Actual GGUF worker and final-only pipeline smoke test; public fixtures only."""
import argparse
import array
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import wave

p = argparse.ArgumentParser()
p.add_argument('--app', type=Path, required=True)
p.add_argument('--models', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
app, models = args.app.resolve(), args.models.resolve()
os.environ['QT_MEDIA_BACKEND'] = 'windows'
cases = [
    '对待每一项工作都要一丝不够。',
    '我已经已经完成了今天的工作。',
    '完全就是给拦柜用的',
    '预览使用雷击原文重新生成标列，不重复加工加标点的文字，更新时保留未变前缀。',
    '今天天气很好，我们准备去公园散步。',
    '张晓明正在调试 Vocal，版本是 v1.0.7。',
    '请支付一百二十三元。',
    'This sentence should remain unchanged.',
]
requests = [dict(type='correct', id=i, text=text, debugTrace=True, fullContext=True,
                 hotwords=['张晓明', 'Vocal']) for i, text in enumerate(cases)]
start = time.monotonic()
process = subprocess.run([str(app), '--correction-worker', '--model-dir', str(models),
                          '--model-id', 'cec3-4b-q4'],
    input=''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in requests),
    capture_output=True, encoding='utf8', timeout=420)
events = [json.loads(line) for line in process.stdout.splitlines() if line.startswith('{')]
report = dict(wallSeconds=time.monotonic() - start, requests=requests, events=events, stderr=process.stderr)
args.output.parent.mkdir(parents=True, exist_ok=True)
def save():
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
save()
assert process.returncode == 0, report
results = [e for e in events if e['type'] == 'result']
assert len(results) == len(cases), events
for index, result in enumerate(results):
    assert result['id'] == index and result['text'], result
    print(json.dumps(dict(input=cases[index], output=result['text'], ms=result['elapsedMs'],
                          decisions=[t['decision'] for t in result['correctionTrace']]), ensure_ascii=False), flush=True)
for i in (4, 5, 6, 7):
    assert results[i]['text'] == cases[i], results[i]
assert results[0]['text'] == '对待每一项工作都要一丝不苟。', results[0]
assert results[1]['text'] == '我已经完成了今天的工作。', results[1]

fixture = models / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
with wave.open(str(fixture)) as audio:
    assert audio.getframerate() == 16000 and audio.getsampwidth() == 2 and audio.getnchannels() == 1
    samples = array.array('f', (x / 32768 for x in array.array('h', audio.readframes(audio.getnframes()))))
with tempfile.TemporaryDirectory(prefix='vocal-sentence-') as folder:
    data = Path(folder)
    (data / 'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False, autoUpdate=False,
        streamingModel='none', correctionModel='cec3-4b-q4', modelId='paraformer-yue-offline',
        injectMode='preview', debugRecording=True)), encoding='utf8')
    pcm = data / 'public.f32'
    pcm.write_bytes(samples.tobytes())
    run = subprocess.run([str(app), '--model-dir', str(models), '--data-dir', folder,
        '--pipeline-test', str(pcm)], capture_output=True, encoding='utf8', timeout=200)
    pipeline = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
    report['pipeline'] = pipeline
    report['pipelineStderr'] = run.stderr
    save()
    assert run.returncode == 0, (pipeline, run.stderr)
    result = pipeline[-1]
    assert result['type'] == 'pipeline-result' and not result['error'], result
    assert '九点' in result['text'] and result['history'] == 1, result
    assert result['contextPasses'] == 1, result
    assert result['contextCorrectionSource'] == ''.join(s['corrected'] for s in result['segmentTranscripts']), result
    assert result['outputRequests'][-1]['final'], result
    print('PASS final-only sentence model: transcript, punctuation, preview/final output, history', flush=True)
