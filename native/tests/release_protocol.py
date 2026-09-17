"""Offline release orchestration regression checks; all gh calls are stubbed."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

repo = Path(__file__).resolve().parents[2]
version = json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version']
shell = shutil.which('pwsh')
assert shell, 'PowerShell 7 is required'


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vocal-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.assets = self.root / 'assets'
        self.assets.mkdir()
        installer = self.assets / f'Vocal-Native-Setup-{version}.exe'
        installer.write_bytes(b'isolated test fixture, never executed')
        self.write_zip(False)

    def write_zip(self, development):
        with zipfile.ZipFile(self.assets / f'Vocal-Native-{version}-win-x64.zip', 'w') as archive:
            archive.writestr('native-release.json', json.dumps({
                'channel': 'native', 'version': version, 'productVersion': version,
                'development': development
            }))
        (self.assets / 'SHA256SUMS.txt').write_text(''.join(
            f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
            for path in sorted(self.assets.iterdir()) if path.suffix in ['.exe', '.zip']
        ))

    def run_publish(self, mode='new', tag=None):
        log = self.root / 'commands.txt'
        result = subprocess.run([
            shell, '-NoProfile', '-NonInteractive', '-File', str(repo / 'native/tests/publish_mock.ps1'),
            '-ArtifactDirectory', str(self.assets), '-Tag', tag or f'v{version}',
            '-Mode', mode, '-LogPath', str(log)
        ], capture_output=True, encoding='utf-8', timeout=25)
        return result, log.read_text(encoding='utf-8-sig') if log.exists() else ''

    def test_new_release_publishes_after_upload_and_verification(self):
        result, commands = self.run_publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--verify-tag --draft', commands)
        self.assertLess(commands.index('release upload'), commands.index('release edit'))
        self.assertIn('--draft=false --latest', commands)
        self.assertTrue(commands.rstrip().endswith('releases/12345'))

    def test_existing_draft_is_completed(self):
        result, commands = self.run_publish('draft')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('release create', commands)
        self.assertIn('--draft=false', commands)

    def test_matching_published_release_is_not_modified(self):
        result, commands = self.run_publish('published')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('release upload', commands)
        self.assertNotIn('release edit', commands)

    def test_remote_hash_mismatch_never_publishes(self):
        result, commands = self.run_publish('tampered')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('release edit', commands)

    def test_invalid_tag_and_preview_never_contact_github(self):
        result, commands = self.run_publish(tag='v999.0.0')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, '')
        self.write_zip(True)
        result, commands = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, '')

    def test_local_hash_mismatch_never_contacts_github(self):
        (self.assets / f'Vocal-Native-Setup-{version}.exe').write_bytes(b'changed')
        result, commands = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, '')


if __name__ == '__main__':
    unittest.main()
