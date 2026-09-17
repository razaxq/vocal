"""Compare real microphone startup; never save or recognize microphone audio.

Fresh probe processes, alternating order, with identical randomized trigger
delays for each pair. Optional ASR timings use only a public model fixture.
"""
import argparse
import array
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import tempfile
import time
import wave


def stats(values):
    ordered = sorted(values)
    index = .95 * (len(ordered) - 1)
    low = int(index)
    p95 = ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * (index - low)
    return dict(n=len(values), mean=statistics.mean(values), median=statistics.median(values),
                p95=p95, min=min(values), max=max(values))


parser = argparse.ArgumentParser()
parser.add_argument('--probe', required=True, type=Path)
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--models', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--pairs', type=int, default=10)
parser.add_argument('--model-id', default='paraformer-yue-offline')
args = parser.parse_args()
assert args.pairs > 0
os.environ['QT_MEDIA_BACKEND'] = 'windows'
rng = random.Random(20260918)
rows = []
output = dict(protocol='Acceptance of trigger to first nonempty PCM delivered to consumer; excludes input debounce, '
                       'speech duration, segmentation and inference. Idle microphone PCM is discarded.',
              order='Alternating pair order, fresh process per trial, same trigger delay per pair.',
              capture=rows)
args.output.parent.mkdir(parents=True, exist_ok=True)


def save():
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf8')


for pair in range(args.pairs):
    delay = 2000 + rng.randrange(200)
    for warm in ((False, True) if pair % 2 == 0 else (True, False)):
        run = subprocess.run([str(args.probe.resolve()), '--capture-warm' if warm else '--capture-cold',
                              '--capture-short', '--trigger-delay', str(delay)],
                             capture_output=True, encoding='utf8', timeout=18)
        events = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
        assert run.returncode == 0, (run.returncode, events, run.stderr)
        result = events[-1]
        assert result['firstFrameMs'] >= 0 and result['first150msAudioAtMs'] >= 0, result
        rows.append(dict(pair=pair + 1, **result))
        save()
        print(f"pair={pair+1} warmup={warm} firstPCM={result['firstFrameMs']:.3f} ms "
              f"150msAudioAt={result['first150msAudioAtMs']:.3f} ms", flush=True)
assert len({row['deviceId'] for row in rows}) == 1, 'Default device changed during experiment'
output['summary'] = {name: {key: stats([row[key] for row in rows if row['warmup'] == enabled])
                            for key in ('firstFrameMs', 'first150msAudioAtMs')}
                     for name, enabled in [('warm', True), ('cold', False)]}
save()

# Additional fresh-worker load and preloaded-worker inference timings. These
# are separate experiments, not an end-to-end hotkey-to-transcript measurement.
fixture = args.models.resolve() / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
with wave.open(str(fixture)) as wav:
    assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
    rate = wav.getframerate()
    pcm = array.array('f', (x / 32768 for x in array.array('h', wav.readframes(wav.getnframes()))))
output['modelProtocol'] = 'Fresh worker process; OS disk cache not cleared. Full public WAV supplied immediately; '
output['modelProtocol'] += 'reported decode time excludes real-time speaking, endpoint waiting and correction.'
output['fixtureDurationMs'] = len(pcm) * 1000 / rate
model_rows = output['model'] = []
with tempfile.TemporaryDirectory(prefix='vocal-latency-fixture-') as temporary:
    path = Path(temporary) / 'public-speech.f32'
    path.write_bytes(pcm.tobytes())
    for trial in range(3):
        started = time.perf_counter_ns()
        requests = [dict(type='decode', id=1, sampleRate=rate, path=str(path)), dict(type='quit')]
        run = subprocess.run([str(args.app.resolve()), '--asr-worker', '--model-dir', str(args.models.resolve()),
                              '--model-id', args.model_id],
                             input=''.join(json.dumps(row) + '\n' for row in requests),
                             capture_output=True, encoding='utf8', timeout=90)
        events = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
        assert run.returncode == 0 and events[0]['type'] == 'ready', (events, run.stderr)
        result = next(row for row in events if row['type'] == 'result')
        model_rows.append(dict(trial=trial + 1, modelId=args.model_id, loadMs=events[0]['elapsedMs'],
                               decodeMs=result['elapsedMs'], text=result['text'],
                               processTotalMs=(time.perf_counter_ns() - started) / 1e6))
        print(f"model trial={trial+1} load={events[0]['elapsedMs']} ms decode={result['elapsedMs']} ms", flush=True)
        save()
output['modelSummary'] = {key: stats([row[key] for row in model_rows]) for key in ('loadMs', 'decodeMs')}
save()
print(json.dumps(output['summary'], ensure_ascii=False, indent=2), flush=True)
