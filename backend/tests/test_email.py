"""``services.email``: the console provider hands the message to logging."""

import logging

from app.config import settings
from app.services import email


def test_console_provider_logs_the_message_instead_of_printing_it(monkeypatch, caplog, capsys):
    monkeypatch.setattr(settings, "email_provider", "console")
    message = email.Email(to="reader@example.com", subject="Confirm", text="Follow this link.")

    with caplog.at_level(logging.INFO, logger="app.services.email"):
        email.send(message)

    (record,) = [record for record in caplog.records if record.name == "app.services.email"]
    assert record.levelno == logging.INFO
    for part in ("reader@example.com", "Confirm", "Follow this link."):
        assert part in record.getMessage()
    assert capsys.readouterr().out == ""
