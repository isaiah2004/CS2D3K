"""Counts non-blank lines of first-party code by area (used for the ownership report)."""
import collections
import os
import sys

EXTS = {'.ts', '.tsx', '.css', '.html', '.mjs', '.py'}
SKIP = {'node_modules', 'screenshots', '.git'}


def area(rel: str) -> str:
    parts = rel.split('/')
    if parts[0] == 'src' and len(parts) > 3 and parts[1] == 'renderer':
        return '/'.join(parts[:4])
    if parts[0] in ('src', 'tests'):
        return '/'.join(parts[:2])
    return parts[0]


def main(roots: list[str]) -> None:
    lines = collections.Counter()
    files = collections.Counter()
    for root in roots:
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP and not d.startswith('out')]
            for f in fn:
                if os.path.splitext(f)[1] not in EXTS:
                    continue
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, '.').replace(os.sep, '/')
                with open(p, encoding='utf8', errors='ignore') as fh:
                    n = sum(1 for line in fh if line.strip())
                lines[area(rel)] += n
                files[area(rel)] += 1
    for k in sorted(lines, key=lambda k: -lines[k]):
        print(f'{k:42s} {files[k]:4d} files {lines[k]:7d} lines')
    print(f'{"TOTAL":42s} {sum(files.values()):4d} files {sum(lines.values()):7d} lines')


if __name__ == '__main__':
    main(sys.argv[1:] or ['src'])
