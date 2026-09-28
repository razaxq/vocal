"""Local paired corrector evaluation. No microphone, settings changes or text injection.

Input JSONL: id, text (the same post-cleanup ASR text for both models), optional
human reference and hotwords. This isolates correction; it does NOT measure ASR,
cleanup, punctuation, multi-segment scheduling, or end-to-end input reliability.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import time
import unicodedata


def normalized(text):
    # Score lexical errors separately from downstream punctuation.
    return ''.join(c for c in unicodedata.normalize('NFC', text)
                   if not c.isspace() and not unicodedata.category(c).startswith('P'))


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        following = [i]
        for j, y in enumerate(b, 1):
            following.append(min(following[-1] + 1, row[j] + 1, row[j-1] + (x != y)))
        row = following
    return row[-1]


def summarize(cases, results):
    result = dict(labelled=0, referenceCharacters=0, errors=0, improved=0,
                  worsened=0, unchangedErrorCount=0, initiallyCorrect=0,
                  initiallyCorrectChanged=0, initiallyCorrectLexicallyBroken=0)
    for case, output in zip(cases, results):
        if 'reference' not in case:
            continue
        reference = normalized(case['reference'])
        before = distance(reference, normalized(case['text']))
        after = distance(reference, normalized(output['text']))
        result['labelled'] += 1
        result['referenceCharacters'] += len(reference)
        result['errors'] += after
        result['improved' if after < before else 'worsened' if after > before else 'unchangedErrorCount'] += 1
        if before == 0:
            result['initiallyCorrect'] += 1
            result['initiallyCorrectChanged'] += output['text'] != case['text']
            result['initiallyCorrectLexicallyBroken'] += after != 0
    result['cer'] = result['errors'] / result['referenceCharacters'] if result['referenceCharacters'] else None
    times = sorted(r['elapsedMs'] for r in results)
    result['medianMs'] = statistics.median(times)
    result['p95Ms'] = times[max(0, math.ceil(len(times) * .95) - 1)]
    return result


def worker(app, models, dictionary, model, requests):
    start = time.monotonic()
    process = subprocess.run([str(app), '--correction-worker', '--model-dir', str(models),
        '--model-id', model, '--dictionary', str(dictionary)],
        input=''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in requests),
        capture_output=True, encoding='utf8', timeout=120 + 125 * len(requests))
    events = [json.loads(line) for line in process.stdout.splitlines() if line.startswith('{')]
    results = [event for event in events if event.get('type') == 'result']
    if process.returncode or len(results) != len(requests) or any(
            r['id'] != q['id'] for r, q in zip(results, requests)):
        raise RuntimeError(f'{model} failed: {events}\n{process.stderr[-4000:]}')
    return results, time.monotonic() - start


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dictionary-enabled', action='store_true')
    parser.add_argument('--dictionary', type=Path, default=Path(__file__).resolve().parents[2] /
                        'resources/dictionaries/rime-ice/catalog.json')
    args = parser.parse_args()
    cases = [json.loads(line) for line in args.cases.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    if not cases or any(not isinstance(c.get('text'), str) or not c['text'].strip() for c in cases):
        parser.error('Cases must contain nonempty text.')
    if any('reference' in c and (not isinstance(c['reference'], str) or not normalized(c['reference'])) for c in cases):
        parser.error('References must contain text. Omit unknown references instead of guessing.')
    app = args.app.resolve()
    report = dict(scope='corrector-only, single-segment input; not end-to-end quality',
                  normalization='NFC; ignore whitespace and punctuation; preserve letter case and digits',
                  dictionaryEnabled=args.dictionary_enabled,
                  executableSha256=hashlib.sha256(app.read_bytes()).hexdigest(),
                  casesSha256=hashlib.sha256(args.cases.read_bytes()).hexdigest(), cases=cases,
                  variants={}, summary={})
    report['variants']['none'] = [dict(text=c['text'], elapsedMs=0) for c in cases]
    requests = [dict(type='correct', id=i, text=c['text'], hotwords=c.get('hotwords', []),
                     dictionaryEnabled=args.dictionary_enabled, debugTrace=True) for i, c in enumerate(cases)]
    segments, segment_wall = worker(app, args.models.resolve(), args.dictionary.resolve(), 'macbert4csc', requests)
    finals, final_wall = worker(app, args.models.resolve(), args.dictionary.resolve(), 'macbert4csc',
        [dict(q, fullContext=True, contextOnly=True, previousText=r['text']) for q, r in zip(requests, segments)])
    report['macbertSegments'] = segments
    for before, after in zip(segments, finals):
        after['elapsedMs'] += before['elapsedMs']
    report['variants']['macbert4csc'] = finals
    sentence, sentence_wall = worker(app, args.models.resolve(), args.dictionary.resolve(), 'cec3-4b-q4',
                                    [dict(q, fullContext=True) for q in requests])
    report['variants']['cec3-4b-q4'] = sentence
    report['batchWallSecondsIncludingLoad'] = dict(macbertTwoProcesses=segment_wall + final_wall,
                                                 sentenceOneProcess=sentence_wall)
    for name, outputs in report['variants'].items():
        report['summary'][name] = summarize(cases, outputs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
