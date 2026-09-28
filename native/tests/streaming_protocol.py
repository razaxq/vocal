"""Streaming sample-rate regressions using synthetic silence only."""
import argparse
import base64
import json
import subprocess
import unittest

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True)
parser.add_argument('--models', required=True)
parser.add_argument('--model', default='zipformer-zh')
args, remaining = parser.parse_known_args()


def audio(segment, rate):
    return dict(type='audio', id=segment, sampleRate=rate,
                samples=base64.b64encode(bytes(rate * 4)).decode())


class StreamingTests(unittest.TestCase):
    def invoke(self, commands):
        run = subprocess.run(
            [args.app, '--stream-worker', '--model-dir', args.models, '--model-id', args.model],
            input=''.join(json.dumps(c) + '\n' for c in commands + [dict(type='quit')]),
            capture_output=True, encoding='utf8', timeout=90)
        events = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
        return run, events

    def test_capture_rates_and_repeated_segments(self):
        commands = []
        for segment, rate in enumerate((16000, 44100, 48000, 48000, 16000), 1):
            commands += [dict(type='start', id=segment), audio(segment, rate),
                         dict(type='finish', id=segment)]
        run, events = self.invoke(commands)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(events[0]['type'], 'ready')
        results = [e for e in events if e['type'] == 'result']
        self.assertEqual([e['id'] for e in results], [1, 2, 3, 4, 5])
        self.assertTrue(all(e['text'] == '' for e in results), results)

    def test_empty_segment(self):
        run, events = self.invoke([dict(type='start', id=1), dict(type='finish', id=1)])
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(events[-1], dict(type='result', id=1, text=''))

    def test_rate_change_returns_error_without_native_abort(self):
        run, events = self.invoke([dict(type='start', id=1), audio(1, 48000), audio(1, 16000)])
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertEqual(events[-1]['type'], 'error')
        self.assertIn('sample rate changed', events[-1]['message'])


unittest.main(argv=[__file__, *remaining])
