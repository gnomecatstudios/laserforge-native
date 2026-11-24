import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts/check-publish-head.py'


def git(*args, cwd):
    return subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                           '-c', 'commit.gpgsign=false', *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class PublishGuardTest(unittest.TestCase):
    """The publish run must stop when main no longer points at the commit it built."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        base = Path(folder.name)
        self.origin = base / 'origin.git'
        self.checkout = base / 'checkout'  # the workflow run's checkout
        git('init', '--bare', '-b', 'main', str(self.origin), cwd=base)
        git('init', '-b', 'main', str(self.checkout), cwd=base)
        git('remote', 'add', 'origin', str(self.origin), cwd=self.checkout)
        git('commit', '--allow-empty', '-m', 'source', cwd=self.checkout)
        git('push', 'origin', 'main', cwd=self.checkout)
        self.built = git('rev-parse', 'HEAD', cwd=self.checkout)

    def guard(self):
        return subprocess.run([sys.executable, str(GUARD), self.built], cwd=self.checkout,
                              capture_output=True, text=True)

    def merge_elsewhere(self):
        other = self.origin.parent / 'other'
        git('clone', str(self.origin), str(other), cwd=self.origin.parent)
        git('commit', '--allow-empty', '-m', 'merged pull request', cwd=other)
        git('push', 'origin', 'main', cwd=other)
        return git('rev-parse', 'HEAD', cwd=other)

    def test_passes_while_main_is_at_the_built_commit(self):
        result = self.guard()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_stops_with_a_redispatch_message_once_main_moves(self):
        head = self.merge_elsewhere()
        result = self.guard()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stdout.startswith(f'::error title=main moved to {head[:7]}::'), result.stdout)
        self.assertIn(f'dispatched on {self.built[:7]}', result.stdout)
        self.assertIn('gh workflow run portable-build.yml --ref main -f publish=true', result.stdout)
        self.assertIn('Re-running this run will not help', result.stdout)


if __name__ == '__main__':
    unittest.main()
