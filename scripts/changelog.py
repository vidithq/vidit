"""Check CHANGELOG.md, and cut its Unreleased section into a release.

    python3 scripts/changelog.py check
    python3 scripts/changelog.py release v1.2.3

`release` renames `## Unreleased` to `## v1.2.3, <today>` and appends the PR
link to each entry, read from the squash subject of the oldest commit on the
first-parent history that added the entry.
"""

import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = "CHANGELOG.md"
PR_URL = "https://github.com/vidithq/vidit/pull/"
MAX_LENGTH = 300
UNRELEASED = "## Unreleased"
LINKS = re.compile(r" \(\[#\d+\]\([^)]+\)(?:, \[#\d+\]\([^)]+\))*\)(?=\.?$)")
SQUASH_PR = re.compile(r"\(#(\d+)\)$")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout


def bare(line: str) -> str:
    """The entry without its PR links and final period: the text a PR adds and a release keeps."""
    return LINKS.sub("", line).removesuffix(".")


def check(lines: list[str]) -> int:
    bad = 0
    for number, line in enumerate(lines, start=1):
        length = len(LINKS.sub("", line))
        if length > MAX_LENGTH:
            print(
                f"::error file={CHANGELOG},line={number}::Line is {length} characters without its PR link; "
                f"keep a CHANGELOG entry to one line of at most {MAX_LENGTH}"
            )
            bad = 1
    return bad


def pr_number(entry: str) -> int | None:
    log = git("log", "--first-parent", "--reverse", "--format=%H %s", "-S", entry, "--", CHANGELOG)
    for row in log.splitlines():
        commit, subject = row.split(" ", 1)
        if entry in {bare(line) for line in git("show", f"{commit}:{CHANGELOG}").splitlines()}:
            match = SQUASH_PR.search(subject)
            return int(match.group(1)) if match else None
    return None


def release(lines: list[str], version: str) -> int:
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version):
        print(f"Version must read vX.Y.Z, got {version!r}", file=sys.stderr)
        return 1
    try:
        start = lines.index(UNRELEASED)
    except ValueError:
        print(f"{CHANGELOG} has no '{UNRELEASED}' heading", file=sys.stderr)
        return 1
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))

    missing = []
    for i in range(start + 1, end):
        line = lines[i]
        if not line.startswith("- ") or LINKS.search(line):
            continue
        number = pr_number(bare(line))
        if number is None:
            missing.append(
                f"{CHANGELOG}:{i + 1}: no squash commit with a (#N) subject adds this entry"
            )
            continue
        link = f" ([#{number}]({PR_URL}{number}))"
        lines[i] = f"{line[:-1]}{link}." if line.endswith(".") else f"{line}{link}"
    if missing:
        print("\n".join(missing), file=sys.stderr)
        return 1

    lines[start] = f"## {version}, {datetime.date.today().isoformat()}"
    (ROOT / CHANGELOG).write_text("\n".join(lines) + "\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "check", help=f"fail on an entry over {MAX_LENGTH} characters, its PR link excluded"
    )
    cut = commands.add_parser("release", help="turn the Unreleased section into a release")
    cut.add_argument("version", help="the release tag, for example v1.2.3")
    args = parser.parse_args()

    lines = (ROOT / CHANGELOG).read_text().splitlines()
    if args.command == "check":
        return check(lines)
    return release(lines, args.version)


if __name__ == "__main__":
    sys.exit(main())
