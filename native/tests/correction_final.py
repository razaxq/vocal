"""Real-model regression: original-source final pass, referents and inference budget."""
import argparse
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--app', required=True, type=Path)
p.add_argument('--models', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
args = p.parse_args()
repo = Path(__file__).resolve().parents[2]
cases = [
    ('完全就是给拦柜用的', '完全就是给懒鬼用的'),
    ('他的身体很建康。', '他的身体很健康。'),
    ('他正在阅渎一本有趣的小说。', '他正在阅读一本有趣的小说。'),
    ('他的身体很健康。', '他的身体很健康。'),
    ('他正在阅读一本有趣的小说。', '他正在阅读一本有趣的小说。'),
    ('她的身体很健康。', '她的身体很健康。'),
    ('二', '二'), ('我们明天早上九点开会', '我们明天早上九点开会'),
    ('代码是 `print(123)`，价格是 123.45 元。', '代码是 `print(123)`，价格是 123.45 元。'),
    ('今夭是个人热词，不要修改。', '今夭是个人热词，不要修改。'),
]

def run(requests, model='macbert4csc'):
    proc = subprocess.run([str(args.app.resolve()), '--correction-worker', '--model-dir', str(args.models.resolve()),
        '--model-id', model, '--dictionary', str(repo / 'resources/dictionaries/rime-ice/catalog.json')],
        input=''.join(json.dumps(q, ensure_ascii=False) + '\n' for q in requests),
        capture_output=True, encoding='utf8', timeout=120)
    assert proc.returncode == 0, (proc.stdout, proc.stderr)
    results = [json.loads(s) for s in proc.stdout.splitlines() if s.startswith('{')]
    results = [r for r in results if r['type'] == 'result']
    assert len(results) == len(requests)
    return results

requests = [dict(type='correct', id=i, text=raw, dictionaryEnabled=True, debugTrace=True,
                 hotwords=['今夭是个人热词']) for i, (raw, _) in enumerate(cases)]
segments = run(requests)
for result, (_, expected) in zip(segments, cases): assert result['text'] == expected, result
assert segments[0]['maskedCalls'] > 0

final_requests = [dict(q, fullContext=True, contextOnly=True, previousText=r['text'])
                  for q, r in zip(requests, segments)]
long = ('This is protected code context. ' * 10) + '今天天汽很好'
final_requests.append(dict(type='correct', id=100, text=long, previousText=long, fullContext=True,
                           contextOnly=True, dictionaryEnabled=True, debugTrace=False))
finals = run(final_requests)
for result, (_, expected) in zip(finals, cases): assert result['text'] == expected, result
assert all(r['maskedCalls'] == 0 for r in finals)
assert finals[-1]['text'] == long[:-6] + '今天天气很好', finals[-1]
assert 'correctionTrace' not in finals[-1]
assert any(t.get('reason') == 'pronoun' for r in segments for t in r['correctionTrace'])
assert any(t.get('reason') == 'protected-or-outside-window' for r in finals[:-1] for t in r['correctionTrace'])

# Non-CSC BERT must retain segment fixes without a costly final masked scan.
bert = run(final_requests[:1], 'bert-chinese-int8')[0]
assert bert['text'] == cases[0][1] and bert['directCalls'] == bert['maskedCalls'] == 0, bert
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(dict(requests=requests, segments=segments,
    finalRequests=final_requests, finals=finals, bert=bert), ensure_ascii=False, indent=2), encoding='utf8')
print('PASS final correction: original source, accepted edits, pronouns, numbers, hotwords, code, late windows; zero final masked calls')
