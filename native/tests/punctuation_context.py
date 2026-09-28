"""Real CT-Transformer regression: right context, bounded windows and exact source preservation."""
import argparse
import json
from pathlib import Path
import subprocess
import unicodedata


def lexical(text):
    return ''.join(c for c in text if not c.isspace() and not unicodedata.category(c).startswith('P'))


p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--app', type=Path, required=True)
p.add_argument('--models', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
reported = ('焦点变化提示修复了一个误报分支预览替换失败或粘贴确认失败'
            '后续也会被误报为焦点变化现在保留真正的失败原因仍会阻止向错误位置输入')
cases = [reported,
         '今天天气很好我们准备去公园散步',
         '你今天准备去哪里',
         'This is a test of English punctuation how are you doing today',
         '版本是 v1.0.7 价格是 123.45 元时间是 10:45',
         '代码是 `print(123)` 链接是 https://example.com/a?x=1 邮箱是 user@example.com',
         '已有标点。下一句？“引号内的内容。”',
         '  开始\n中间的内容\t结束  ',
         '🙂你好𠀀这是扩展字符', '', '   ',
         ('今天天气很好我们准备去公园散步下午还要回家完成剩余工作' * 24) + '最后一句结束',
         ('Mixed English 中文123。' * 180) + '最后一句结束']
requests = [dict(type='punctuate', id=i, text=t) for i, t in enumerate(cases)]
run = subprocess.run([str(args.app.resolve()), '--asr-worker', '--model-id', 'none',
                      '--model-dir', str(args.models.resolve())],
    input=''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in requests),
    capture_output=True, encoding='utf8', timeout=90)
events = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
results = [e for e in events if e.get('type') == 'result']
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(dict(requests=requests, events=events, stderr=run.stderr),
                                 ensure_ascii=False, indent=2), encoding='utf8')
assert run.returncode == 0 and len(results) == len(cases), (events, run.stderr)
for i, (source, result) in enumerate(zip(cases, results)):
    assert result['id'] == i, result
    assert lexical(result['text']) == lexical(source), (source, result)
    assert result['punctuationCalls'] == bool(source), result
assert '误报为焦点变化' in results[0]['text'], results[0]
assert '误报分支，预览替换失败' in results[0]['text'], results[0]
assert results[2]['text'].endswith('？'), results[2]
for protected in ('v1.0.7', '123.45', '10:45'):
    assert protected in results[4]['text'], results[4]
for protected in ('`print(123)`', 'https://example.com/a?x=1', 'user@example.com'):
    assert protected in results[5]['text'], results[5]
assert results[6]['text'] == cases[6], results[6]
assert results[7]['text'].startswith('  ') and results[7]['text'].endswith('  '), results[7]
assert results[9]['text'] == '' and results[10]['text'] == '   ', results[9:11]
print(json.dumps(results[0], ensure_ascii=False))
print('PASS full-context punctuation: reported split, English, protected spans, whitespace, Unicode, long overlapping windows')
