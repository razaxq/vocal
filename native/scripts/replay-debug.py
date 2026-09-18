"""Replay saved local worker inputs without microphone, hooks, clipboard or cloud calls.

Example: python native/scripts/replay-debug.py SESSION --app APP --models MODELS --output result.json
The original inputs/boundaries are reused to isolate model changes; this does not
simulate device startup, GUI frame timing or third-party editor behavior.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile


def load_audio(path):
    wav = path.read_bytes()
    if wav[:4] != b'RIFF' or wav[8:12] != b'WAVE':
        raise ValueError('Not a WAV recording')
    pos, fmt, pcm = 12, None, None
    while pos + 8 <= len(wav):
        kind, size = struct.unpack_from('<4sI', wav, pos)
        block = wav[pos + 8:pos + 8 + size]
        if len(block) != size:
            raise ValueError('Truncated WAV')
        if kind == b'fmt ': fmt = struct.unpack_from('<HHIIHH', block)
        if kind == b'data': pcm = block
        pos += 8 + size + size % 2
    if not fmt or fmt[0] != 3 or fmt[1] != 1 or fmt[5] != 32 or pcm is None or len(pcm) % 4:
        raise ValueError('Expected mono float32 WAV')
    return fmt[2], pcm


def replay(session, app, models):
    meta = json.loads((session / 'session.json').read_text(encoding='utf8'))
    if meta.get('schemaVersion') != 1: raise ValueError('Unsupported recording format')
    rate, pcm = load_audio(session / 'audio.wav')
    if hashlib.sha256(pcm).hexdigest() != meta['audio']['sha256']:
        raise ValueError('Audio checksum differs; recording may be incomplete')
    events = [json.loads(x) for x in (session / 'events.jsonl').read_text(encoding='utf8').splitlines() if x]
    if any(e['stage'] == 'worker.request' and e['message'].get('type') == 'dictionary:update' for e in events):
        raise ValueError('Dictionary changed during recording; replay needs the intermediate dictionary snapshot')
    dictionary = (session / meta['dictionary']['path']).resolve()
    if not dictionary.is_relative_to(session.parent.resolve()): raise ValueError('Dictionary outside debug folder')
    if hashlib.sha256(dictionary.read_bytes()).hexdigest() != meta['dictionary']['sha256']:
        raise ValueError('Dictionary checksum differs')
    cuts = {e['id']: e for e in events if e['stage'] == 'segment.cut'}
    report = {'originalVersion': meta['version'], 'originalBuild': meta.get('build'),
              'originalSummary': meta.get('summary'), 'workers': {},
              'scope': 'Original local model inputs; cloud, capture timing and text injection are not replayed.'}
    with tempfile.TemporaryDirectory(prefix='vocal-debug-replay-') as temp:
        segment_paths = {}
        for ident, cut in cuts.items():
            first, last = cut['startSample'] * 4, (cut['startSample'] + cut['samples']) * 4
            if first < 0 or last > len(pcm): raise ValueError('Segment exceeds recording')
            path = Path(temp) / f'{ident}.f32'
            path.write_bytes(pcm[first:last])
            segment_paths[ident] = path
        for role, flag, setting in [('offline', '--asr-worker', 'modelId'),
                                    ('streaming', '--stream-worker', 'streamingModel'),
                                    ('correction', '--correction-worker', 'correctionModel')]:
            requests, cursors = [], {}
            for event in events:
                if event['stage'] != 'worker.request' or event['worker'] != role: continue
                message = dict(event['message'])
                kind, ident = message.get('type'), message.get('id')
                if kind not in ('start', 'audio', 'finish', 'decode', 'correct', 'punctuate'): continue
                if kind == 'decode': message['path'] = str(segment_paths[ident])
                if kind == 'start': cursors[ident] = cuts.get(ident, {}).get('startSample')
                if kind == 'audio':
                    if cursors.get(ident) is None:
                        raise ValueError('Uncut streaming tail: inspect events manually')
                    count = message.pop('sampleCount')
                    begin, end = cursors[ident] * 4, (cursors[ident] + count) * 4
                    if end > len(pcm): raise ValueError('Streaming packet exceeds recording')
                    message['samples'] = base64.b64encode(pcm[begin:end]).decode()
                    cursors[ident] += count
                requests.append(message)
            if not requests: continue
            process = subprocess.run([str(app), flag, '--model-dir', str(models), '--model-id',
                meta['settings'][setting], '--dictionary', str(dictionary)],
                input=''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in requests),
                encoding='utf8', capture_output=True, timeout=600)
            responses = [json.loads(x) for x in process.stdout.splitlines() if x.startswith('{')]
            if process.returncode or any(e.get('type') == 'error' for e in responses):
                raise RuntimeError(f'{role}: {responses[-3:]} {process.stderr[-2000:]}')
            original = {e['message']['id']: e['message'] for e in events
                        if e['stage'] == 'worker.response' and e['worker'] == role
                        and e['message'].get('type') == 'result'}
            results = [e for e in responses if e.get('type') == 'result']
            report['workers'][role] = [dict(id=e['id'], original=original.get(e['id']), replay=e,
                sameText=e.get('text') == original.get(e['id'], {}).get('text')) for e in results]
            if set(original) - {e['id'] for e in results}:
                raise RuntimeError(f'Missing replay results: {role}')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('session', type=Path)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--models', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = replay(args.session.resolve(), args.app.resolve(), args.models.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    results = [r for entries in report['workers'].values() for r in entries]
    print(f'Replayed {len(results)} results; {sum(r["sameText"] for r in results)} unchanged. Report: {args.output}')


if __name__ == '__main__': main()
