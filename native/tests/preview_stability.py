"""Regression for release-time transcript deterioration, using supplied text only.
No microphone, keyboard hooks, external services, or user history are accessed.
"""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--models', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
preview = ('现在尝试新一轮的语音测试，按道理来说，已经完全是没有任何问题的。'
           '好的，那我现在开始进行长文章的论述，已在本地完成预览使用雷击原文，'
           '重新生成标列，不重复加工加标点的文字更新时保留未变前缀。')
raw = preview.translate(str.maketrans('', '', '，。'))
requests = []
for text in (preview, raw):
    for full in (False, True):
        requests.append(dict(type='correct', id=len(requests) + 1, text=text, fullContext=full, dictionaryEnabled=True))
# Existing useful corrections and unchanged numbers must still work.
for text in ('完全就是给拦柜用的', '今天天汽很好', '我们明天早上九点开会', '请支付一百二十三元'):
    requests.append(dict(type='correct', id=len(requests) + 1, text=text, fullContext=True, dictionaryEnabled=True))
process = subprocess.run([str(args.app.resolve()), '--correction-worker', '--model-dir', str(args.models.resolve()),
    '--dictionary', str(repo / 'resources/dictionaries/rime-ice/catalog.json')],
    input=''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in requests), capture_output=True, encoding='utf8', timeout=120)
assert process.returncode == 0, process.stderr
results = [json.loads(x) for x in process.stdout.splitlines() if x.startswith('{')]
results = [x for x in results if x['type'] == 'result']
assert len(results) == len(requests), results
for request, result in zip(requests[:4], results[:4]):
    text = result['text']
    for retained in ('现在尝试', '已在本地完成', '预览', '未变前缀'):
        assert retained in text, (request, result)
    for introduced in ('想在尝试', '向在尝试', '一在本地', '预然', '未遍前序'):
        assert introduced not in text, (request, result)
assert results[4]['text'] == '完全就是给懒鬼用的', results[4]
assert results[5]['text'] == '今天天气很好', results[5]
assert results[6]['text'] == requests[6]['text'], results[6]
assert results[7]['text'] == requests[7]['text'], results[7]
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(dict(requests=requests, results=results), ensure_ascii=False, indent=2), encoding='utf8')
print('PASS user preview: protected wording survives segmented/full-context correction, with/without punctuation')
print('PASS existing homophone corrections and spoken numbers')
