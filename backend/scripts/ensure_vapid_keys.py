"""Give ``backend/.env`` a development VAPID key pair when it has none.

``make env`` runs it after copying ``.env.example``. A key or subject already
set is never replaced, so running it again changes nothing.
"""

from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec

DEV_SUBJECT = "mailto:dev@example.com"


def generate_private_key() -> str:
    """A base64url raw P-256 private key, the form ``VAPID_PRIVATE_KEY`` takes."""
    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.private_numbers().private_value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _set_if_empty(lines: list[str], name: str, value: str) -> bool:
    active = re.compile(rf"^\s*{name}\s*=(.*)$")
    for i, line in enumerate(lines):
        match = active.match(line)
        if match:
            if match.group(1).strip():
                return False
            lines[i] = f"{name}={value}"
            return True
    commented = re.compile(rf"^\s*#\s*{name}\s*=")
    for i, line in enumerate(lines):
        if commented.match(line):
            lines[i] = f"{name}={value}"
            return True
    lines.append(f"{name}={value}")
    return True


def ensure(env_path: Path) -> list[str]:
    """Fill the missing VAPID settings of ``env_path``; return the names it set."""
    lines = env_path.read_text().splitlines()
    added = [
        name
        for name, value in (
            ("VAPID_PRIVATE_KEY", generate_private_key()),
            ("VAPID_SUBJECT", DEV_SUBJECT),
        )
        if _set_if_empty(lines, name, value)
    ]
    if added:
        env_path.write_text("\n".join(lines) + "\n")
    return added


def main() -> None:
    env_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[1] / ".env"
    added = ensure(env_path)
    if added:
        print(f"Set {', '.join(added)} in {env_path} for local push notifications")


if __name__ == "__main__":
    main()
