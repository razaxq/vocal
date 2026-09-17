"""Capture all overlay modes with isolated settings; assert width-before-height growth."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
reports = []
for theme in ('light', 'dark'):
    for mode, name, text in (
        ('all', 'short', '今天天气很好。'),
        ('all', 'medium', '我觉得时间差不多可以睡觉了，你觉得怎么样呢？'),
        ('all', 'long', '我觉得时间差不多可以睡觉了，你觉得怎么样呢？因为现在已经五点十九分了。' * 4),
        ('latest', 'long', '这是前面的预览文字。' * 12 + '这三行是最新的内容。我们只显示最近的识别结果。最后一句到这里结束。'),
        ('none', 'long', '不应出现在悬浮窗中的文字。' * 10),
        ('all', 'english', 'The preview adds punctuation as you speak. Earlier sentences are updated when needed, and unchanged text is kept. ' * 3),
    ):
        with tempfile.TemporaryDirectory(prefix='vocal-overlay-modes-') as directory:
            data = Path(directory)
            (data / 'settings.json').write_text(json.dumps(dict(serviceEnabled=False,
                dictionaryAutoUpdate=False, autoUpdate=False, overlayTextMode=mode, theme=theme)), encoding='utf8')
            result = subprocess.run([str(args.app.resolve()), '--data-dir', str(data), '--smoke-test',
                str((args.output / f'{theme}-{mode}-{name}.png').resolve()), '--smoke-ui-only',
                '--smoke-overlay', 'auto', '--smoke-overlay-text', text], capture_output=True, encoding='utf8', timeout=25)
            assert result.returncode == 0, result.stderr
            assert not any(s in result.stderr for s in ('ReferenceError', 'TypeError', 'Binding loop', 'Unable to assign')), result.stderr
            dimensions = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')][-1]
            if mode == 'none':
                assert dimensions['width'] == 208 and dimensions['height'] == 64, dimensions
            if mode == 'latest':
                assert dimensions['textHeight'] == 66, dimensions
            reports.append(dict(theme=theme, name=name, **dimensions))
            print('PASS', reports[-1], flush=True)
    short, medium, long = reports[-6:-3]
    assert short['width'] < medium['width'] <= long['width'], (short, medium, long)
    assert short['height'] == medium['height'] < long['height'], (short, medium, long)
(args.output / 'layouts.json').write_text(json.dumps(reports, indent=2), encoding='utf8')
