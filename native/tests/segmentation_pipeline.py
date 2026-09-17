"""Real ASR/CSC regression using public audio, isolated settings and no input hooks."""
import argparse
import array
import json
import os
from pathlib import Path
import subprocess
import tempfile
import wave
import unicodedata

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--models', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
app, models, output = args.app.resolve(), args.models.resolve(), args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
os.environ['QT_MEDIA_BACKEND'] = 'windows'
fixture = models / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
with wave.open(str(fixture)) as recording:
    assert recording.getframerate() == 16000 and recording.getnchannels() == 1
    speech = array.array('f', (s / 32768 for s in array.array('h', recording.readframes(recording.getnframes()))))
def run(arguments, requests=None):
    process = subprocess.run([str(app), *map(str, arguments)],
        input=None if requests is None else ''.join(json.dumps(x) + '\n' for x in requests),
        encoding='utf-8', capture_output=True, timeout=180)
    assert process.returncode == 0, (process.returncode, process.stderr[-4000:], process.stdout[-3000:])
    assert not any(s in process.stderr for s in ('ReferenceError', 'TypeError', 'Binding loop', 'Unable to assign'))
    return [json.loads(line) for line in process.stdout.splitlines() if line.startswith('{')]

reports = []
for streaming, offline, correction, automatic in [('none', 'paraformer-yue-offline', 'macbert4csc', False),
                                       ('paraformer-zh-en', 'paraformer-yue-offline', 'macbert4csc', False),
                                       ('paraformer-zh-en', 'none', 'none', False),
                                       ('none', 'paraformer-yue-offline', 'none', False),
                                       ('none', 'paraformer-yue-offline', 'macbert4csc', True),
                                       ('paraformer-zh-en', 'paraformer-yue-offline', 'macbert4csc', True)]:
    with tempfile.TemporaryDirectory(prefix='segmented-vocal-') as directory:
        data = Path(directory)
        settings = dict(dictionaryAutoUpdate=False, autoUpdate=False, streamingModel=streaming,
                        modelId=offline, correctionModel=correction, endpointSilenceMs=1500,
                        automaticSegmentation=automatic, injectMode="preview" if automatic else "final")
        (data / 'settings.json').write_text(json.dumps(settings), encoding='utf-8')
        pcm = data / 'speech.f32'
        pause = array.array('f', [0]) * (6400 if automatic else 24000)
        pcm.write_bytes((speech + pause + speech + pause + speech).tobytes())
        result = run(['--model-dir', models, '--data-dir', data, '--pipeline-test', pcm,
                      '--pipeline-packet-ms', '100'])[-1]
        assert result['text'].count('九点') == 3, result
        assert result['segments'] == 3 and result['history'] == 1 and not result['error'], result
        assert 'and' not in result['text'].lower(), result # No hallucinated startup-click segment.
        assert result['contextPasses'] == (1 if correction != 'none' else 0), result
        # Each retained segment is decoded once. Release must not run a second
        # whole-recording ASR and overwrite the established segment transcript.
        assert result['decodePasses'] == result['segments'], result
        assert result['raw'] == ''.join(item['raw'] for item in result['segmentTranscripts']), result
        if correction != 'none':
            assert result['contextCorrectionSource'] == ''.join(item['corrected'] for item in result['segmentTranscripts']), result
        assert result['punctuationPasses'] >= 2, result
        assert result['committedWhileRecording'], result
        requested = result['outputRequests']
        assert requested[-1]['final'] and requested[-1]['text'] == result['text'], result
        if automatic:
            assert any(not item['final'] and item['recording'] for item in requested), result
        else:
            assert len(requested) == 1, requested
        sources = result['punctuationSources']
        assert len(sources) >= 2 and len(set(sources)) == len(sources), sources
        assert all('，' not in source and '。' not in source for source in sources), sources
        assert sources[-1].count('九点') == 3, sources
        if streaming == 'none':
            assert result['offlinePreview'], result
        reports.append(dict(streaming=streaming, offline=offline, correction=correction, automatic=automatic, **result))
        print(f'PASS continuous PCM: stream={streaming}, offline={offline}, correction={correction}, auto={automatic}', flush=True)

# A short pause deliberately splits one utterance. Without CSC/cleanup, final
# letters must be the same as the segment results; punctuation may change.
with tempfile.TemporaryDirectory(prefix='vocal-stable-context-') as directory:
    data = Path(directory)
    (data / 'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False, autoUpdate=False,
        streamingModel='none', modelId='paraformer-yue-offline', correctionModel='none', cleanupLevel='off',
        automaticSegmentation=True, injectMode='preview')), encoding='utf8')
    split = 16000 * 27 // 10
    pcm = data / 'speech.f32'
    pcm.write_bytes((speech[:split] + array.array('f', [0]) * 12800 + speech[split:]).tobytes())
    result = run(['--model-dir', models, '--data-dir', data, '--pipeline-test', pcm,
                  '--pipeline-packet-ms', '100'])[-1]
    assert result['segments'] >= 2 and result['decodePasses'] == result['segments'], result
    assert result['punctuationPasses'] >= 2 and result['contextPasses'] == 0, result
    letters = lambda text: ''.join(c for c in text if not c.isspace() and not unicodedata.category(c).startswith('P'))
    accumulated = ''.join(item['raw'] for item in result['segmentTranscripts'])
    assert letters(result['text']) == letters(accumulated) == letters(result['raw']), result
    for source in result['punctuationSources']:
        assert accumulated.startswith(source), (source, accumulated)
    reports.append(dict(case='short pause preserves segment wording at release', **result))
    print('PASS short pause: final wording preserves accumulated segments; no second ASR', flush=True)

# A final pass must visit the end of long text, with left/right context windows.
long_text = ('This is a protected English context. ' * 9) + '今天天汽很好'
repo = Path(__file__).resolve().parents[2]
result = run(['--correction-worker', '--model-dir', models, '--dictionary',
              repo / 'resources/dictionaries/rime-ice/catalog.json'],
             [dict(type='correct', id=1, text=long_text, dictionaryEnabled=False, fullContext=True)])[-1]
assert result['text'] == long_text[:-6] + '今天天气很好', result
print('PASS final context correction reaches the last window and preserves English', flush=True)

for show in ("all", "latest", "none"):
    with tempfile.TemporaryDirectory(prefix='overlay-vocal-') as directory:
        data = Path(directory)
        (data / 'settings.json').write_text(json.dumps(dict(serviceEnabled=False, streamingModel='none',
            dictionaryAutoUpdate=False, autoUpdate=False, overlayTextMode=show)), encoding='utf-8')
        run(['--data-dir', data, '--smoke-test', output / f'overlay-text-{show}.png',
             '--smoke-ui-only', '--smoke-overlay', 'auto'])
    print(f'PASS overlay transcript switch without streaming: {show}', flush=True)
(output / 'results.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
