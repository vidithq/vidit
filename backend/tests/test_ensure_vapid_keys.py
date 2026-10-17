import importlib.util
from pathlib import Path

from py_vapid import Vapid

_SPEC = importlib.util.spec_from_file_location(
    "ensure_vapid_keys", Path(__file__).parents[1] / "scripts" / "ensure_vapid_keys.py"
)
assert _SPEC and _SPEC.loader
ensure_vapid_keys = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ensure_vapid_keys)


def test_fills_the_template_with_a_usable_key(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# VAPID_PRIVATE_KEY=\n# VAPID_SUBJECT=mailto:support@vidit.app\n")
    assert ensure_vapid_keys.ensure(env) == ["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
    values = dict(line.split("=", 1) for line in env.read_text().splitlines())
    assert values["VAPID_SUBJECT"] == "mailto:dev@example.com"
    Vapid.from_string(private_key=values["VAPID_PRIVATE_KEY"])


def test_never_replaces_a_key_already_set(tmp_path):
    env = tmp_path / ".env"
    env.write_text("VAPID_PRIVATE_KEY=kept\nVAPID_SUBJECT=\n")
    assert ensure_vapid_keys.ensure(env) == ["VAPID_SUBJECT"]
    assert env.read_text() == "VAPID_PRIVATE_KEY=kept\nVAPID_SUBJECT=mailto:dev@example.com\n"
    assert ensure_vapid_keys.ensure(env) == []
