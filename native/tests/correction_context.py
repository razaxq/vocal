"""Replay a fixed correction corpus through real local models; no user input access."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--models', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
stable = [
    '完全就是给懒鬼用的', '这家店的拦柜很旧了', '今天天气很好', '程序会自动更新',
    '请打开 GitHub，版本是 v0.1.9。', '我想使用完整词库', '这个软件可以提高工作效率',
    '我们明天早上九点开会', '请支付一百二十三元', '张晓明正在调试 Vocal',
    '已在本地完成预览，更新时保留未变前缀。',
    '访问 https://example.com/a1 或发送邮件到 test@example.com。',
    '代码是 `print(123)`，价格是 123.45 元。',
    '今夭是个人热词，不要修改。',
]
homophones = {'完全就是给拦柜用的': '完全就是给懒鬼用的', '今天天汽很好': '今天天气很好',
              '你找到你最喜欢的工作，我也很高心。': '你找到你最喜欢的工作，我也很高兴。'}
exploratory = [
    '今夭天气很好', '我们明夭一起去公园散步。', '请在句子末尾加上标列。',
    '预览使用雷击原文重新生成标点。', '我己经完成了今天的工作。',
    '他的身体很建康。', '这次考试的成债很好。', '这是一座美丽的城巿。',
    '他正在阅渎一本有趣的小说。', '请把这份文件发给我。',
]
contextual = {'今夭天气很好': '今天天气很好',
              '我们明夭一起去公园散步。': '我们明天一起去公园散步。',
              '我己经完成了今天的工作。': '我已经完成了今天的工作。'}
report = {}
for model in ('macbert4csc', 'bert-chinese-int8'):
    requests = []
    for dictionary in (False, True):
        for text in stable + list(homophones) + exploratory:
            requests.append(dict(type='correct', id=len(requests), text=text,
                                 fullContext=True, dictionaryEnabled=dictionary,
                                 hotwords=['张晓明', 'Vocal', '今夭是个人热词']))
    process = subprocess.run([str(args.app.resolve()), '--correction-worker', '--model-id', model,
        '--model-dir', str(args.models.resolve()), '--dictionary',
        str(repo / 'resources/dictionaries/rime-ice/catalog.json')],
        input=''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in requests),
        capture_output=True, encoding='utf8', timeout=240)
    assert process.returncode == 0, (model, process.stdout, process.stderr)
    results = [json.loads(line) for line in process.stdout.splitlines() if line.startswith('{')]
    results = [r for r in results if r['type'] == 'result']
    assert len(results) == len(requests), results
    report[model] = [dict(request=r, result=v) for r, v in zip(requests, results)]
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
for model, records in report.items():
    for entry in records:
        request, result = entry['request'], entry['result']
        if request['text'] in stable:
            assert result['text'] == request['text'], (model, entry)
        if model == 'macbert4csc' and request['dictionaryEnabled'] and request['text'] in homophones:
            assert result['text'] == homophones[request['text']], entry
        if model == 'bert-chinese-int8' and not request['dictionaryEnabled']:
            assert result['text'] == request['text'], entry
        if not args.baseline and model == 'macbert4csc' and request['text'] in contextual:
            assert result['text'] == contextual[request['text']], entry
    print(f'PASS {model}: {len(records)} replays; unchanged/protected sentences and correction checks')
