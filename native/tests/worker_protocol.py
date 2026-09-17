"""Native worker integration tests. Run after building, with Qt DLLs on PATH.

Uses only the existing public model WAV fixtures. No user audio or application
input is accessed. All temporary files are removed by TemporaryDirectory.
"""
import argparse
import array
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True)
parser.add_argument('--models', required=True)
args, remaining = parser.parse_known_args()


class WorkerTests(unittest.TestCase):
    def invoke(self, commands, model='paraformer-yue-offline'):
        run = subprocess.run(
            [args.app, '--asr-worker', '--model-dir', args.models, '--model-id', model],
            input=''.join(json.dumps(cmd) + '\n' for cmd in commands),
            text=True, encoding='utf-8', capture_output=True, timeout=100,
        )
        events = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
        return run.returncode, events

    def test_pcm_protocol_repeated_decode_and_silence(self):
        fixture = Path(args.models) / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
        with wave.open(str(fixture)) as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            rate = wav.getframerate()
            pcm = array.array('h', wav.readframes(wav.getnframes()))
        with tempfile.TemporaryDirectory(prefix='vocal-native-test-') as directory:
            path = Path(directory) / 'speech.f32'
            path.write_bytes(array.array('f', (sample / 32768 for sample in pcm)).tobytes())
            silence = Path(directory) / 'silence.f32'
            silence.write_bytes(bytes(rate * 4))
            commands = [dict(type='decode', id=i, sampleRate=rate, path=str(path)) for i in (1, 2)]
            commands += [dict(type='decode', id=3, sampleRate=rate, path=str(silence)), dict(type='quit')]
            code, events = self.invoke(commands)
        self.assertEqual(code, 0, events)
        self.assertEqual(events[0]['type'], 'ready')
        results = [event for event in events if event['type'] == 'result']
        self.assertEqual([event['id'] for event in results], [1, 2, 3])
        self.assertIn('九点', results[0]['text'])
        self.assertEqual(results[0]['text'], results[1]['text'])
        self.assertEqual(results[2]['text'], '')

    def test_unknown_model_is_recoverable_error(self):
        code, events = self.invoke([], model='does-not-exist')
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]['type'], 'error')

    def test_invalid_audio_request_fails_explicitly(self):
        code, events = self.invoke([dict(type='decode', sampleRate=0, path='not-a-file')])
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]['type'], 'error')

    def test_sensevoice_preserves_own_punctuation(self):
        fixture = Path(args.models) / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
        run = subprocess.run([args.app, '--transcribe', str(fixture), '--model-dir', args.models,
                              '--model-id', 'sensevoice-2024'], capture_output=True,
                             encoding='utf-8', timeout=90)
        self.assertEqual(run.returncode, 0, run.stderr)
        event = json.loads(run.stdout)
        self.assertIn('9', event['text'])
        self.assertNotIn('。。', event['text'])


unittest.main(argv=[__file__, *remaining])
