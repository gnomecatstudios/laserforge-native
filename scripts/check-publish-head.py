#!/usr/bin/env python3
"""Stop a portable publish run whose commit is no longer the head of main.

The "Build portable packages" workflow builds the ZIPs from the commit the run was
dispatched on, then commits them to main directly on top of that commit. If main has
moved since, those ZIPs do not match the source at main's head, so the run must not
publish them. Re-running the run cannot help, because a re-run builds the same old
commit again; only a new dispatch on main can.

Usage: python3 scripts/check-publish-head.py "$GITHUB_SHA"

Exits 0 while origin's main is still at that commit. Otherwise prints a GitHub
Actions error annotation that says what to do, and exits 1.
"""
import re
import subprocess
import sys

REF = 'refs/heads/main'
REDISPATCH = 'gh workflow run portable-build.yml --ref main -f publish=true'


def remote_head(remote='origin', cwd=None):
    """Return the commit origin's main points at now, or None if it has no main."""
    # Asks the remote directly, with the credentials the publish push uses.
    listing = subprocess.run(['git', 'ls-remote', remote, REF], cwd=cwd, check=True,
                             stdout=subprocess.PIPE, text=True).stdout
    # ls-remote matches on the end of ref names, so keep only the exact ref.
    for line in listing.splitlines():
        sha, name = line.split('\t', 1)
        if name == REF:
            return sha
    return None


def moved_error(built, head):
    """The annotation for a run whose commit is no longer main's head."""
    if head is None:
        return '::error title=main not found::origin has no main branch, so this run cannot publish.'
    return (f'::error title=main moved to {head[:7]}::'
            f'This run was dispatched on {built[:7]}, but main is now at {head[:7]}. '
            f'Its packages would not match the source at main\'s head, so it will not publish them. '
            f'Dispatch a new publish run on main: Actions > Build portable packages > Run workflow, '
            f'with "Publish verified ZIPs" checked, or {REDISPATCH}. '
            f'Re-running this run will not help: a re-run builds {built[:7]} again.')


def main(argv):
    if len(argv) != 1 or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', argv[0]):
        sys.exit('usage: check-publish-head.py FULL_COMMIT_SHA')
    built = argv[0]
    head = remote_head()
    if head != built:
        print(moved_error(built, head), flush=True)
        return 1
    print(f'main is still at {built[:7]}, the commit this run builds.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
