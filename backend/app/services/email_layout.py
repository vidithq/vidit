"""The one Vidit email layout: structured content in, an HTML part and a
plain-text part out.

A builder in ``services/email`` passes a heading, blocks, at most one action
and a closing note. Both parts come from the same content, so they carry the
same words and links. The HTML is a single 600 px table column with inline
styles, the form Gmail, Outlook and Apple Mail all render.
"""

from __future__ import annotations

import html
import re
import textwrap
from collections.abc import Sequence
from dataclasses import dataclass

from app.config import settings

# Mirrors the default accent scale in frontend ``app/globals.css`` (Tailwind
# orange) and the brand mark route ``app/icon.tsx``; change both.
_ACCENT_FILL = "#c2410c"
_ACCENT_TEXT_DARK = "#fb923c"
_LOGO_PATH = "/icon/android-192"

_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_TEXT_WIDTH = 72
_URL_RE = re.compile(r"https?://[^\s<>\"']+")


@dataclass(frozen=True)
class Action:
    label: str
    url: str


# A paragraph, or a tuple of lines shown as a list. A newline inside a
# paragraph is kept as a line break.
Block = str | tuple[str, ...]


@dataclass(frozen=True)
class Content:
    heading: str
    blocks: Sequence[Block]
    action: Action | None = None
    note: str | None = None


def app_url(path: str) -> str:
    """An absolute URL on the frontend origin."""
    return f"{settings.frontend_url.rstrip('/')}{path}"


def settings_url() -> str:
    return app_url("/settings")


def _wrap(text: str, hang: str = "") -> str:
    return "\n".join(
        textwrap.fill(
            line,
            width=_TEXT_WIDTH,
            subsequent_indent=hang,
            break_long_words=False,
            break_on_hyphens=False,
        )
        if line
        else ""
        for line in text.split("\n")
    )


def _footer_lines() -> list[tuple[str, str]]:
    return [
        ("Notification settings", settings_url()),
        ("Legal notice", app_url("/legal")),
    ]


def render_text(content: Content) -> str:
    parts = [content.heading]
    for block in content.blocks:
        if isinstance(block, tuple):
            parts.append("\n".join(_wrap(f"* {line}", "  ") for line in block))
        else:
            parts.append(_wrap(block))
    if content.action is not None:
        parts.append(f"{content.action.label}:\n\n  {content.action.url}")
    if content.note:
        parts.append(_wrap(content.note))
    parts.append("Vidit\n" + "\n".join(f"{label}: {url}" for label, url in _footer_lines()))
    return "\n\n".join(parts) + "\n"


def _inline(text: str) -> str:
    """Escape ``text`` and turn each bare URL into a link."""
    out = []
    last = 0
    for match in _URL_RE.finditer(text):
        out.append(html.escape(text[last : match.start()]))
        url = html.escape(match.group(0))
        out.append(f'<a href="{url}" class="v-link" style="color:{_ACCENT_FILL};">{url}</a>')
        last = match.end()
    out.append(html.escape(text[last:]))
    return "".join(out).replace("\n", "<br>")


_P = f"margin:0 0 16px;font-family:{_FONT};font-size:15px;line-height:24px;color:#232323;"


def _html_block(block: Block) -> str:
    if isinstance(block, tuple):
        items = "".join(f'<li style="margin:0 0 4px;">{_inline(line)}</li>' for line in block)
        return f'<ul class="v-text" style="{_P}padding:0 0 0 20px;">{items}</ul>'
    return f'<p class="v-text" style="{_P}">{_inline(block)}</p>'


def _html_action(action: Action) -> str:
    url = html.escape(action.url)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:8px 0 12px;"><tr>'
        f'<td bgcolor="{_ACCENT_FILL}" style="border-radius:6px;background-color:{_ACCENT_FILL};">'
        f'<a href="{url}" style="display:inline-block;padding:12px 22px;font-family:{_FONT};'
        "font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;"
        f'border-radius:6px;">{html.escape(action.label)}</a>'
        "</td></tr></table>"
        f'<p class="v-muted" style="margin:0 0 24px;font-family:{_FONT};font-size:12px;'
        'line-height:18px;color:#5c5c5c;word-break:break-all;">'
        f"Or paste this link into your browser: {_inline(action.url)}</p>"
    )


def render_html(content: Content, *, subject: str) -> str:
    body = "".join(_html_block(b) for b in content.blocks)
    if content.action is not None:
        body += _html_action(content.action)
    if content.note:
        body += (
            f'<p class="v-muted" style="margin:0;font-family:{_FONT};font-size:13px;'
            f'line-height:20px;color:#5c5c5c;">{_inline(content.note)}</p>'
        )
    footer = " &middot; ".join(
        f'<a href="{html.escape(url)}" class="v-muted" style="color:#737373;">'
        f"{html.escape(label)}</a>"
        for label, url in _footer_lines()
    )
    logo = html.escape(app_url(_LOGO_PATH))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{html.escape(subject)}</title>
<style>
@media (prefers-color-scheme: dark) {{
  .v-bg {{ background-color:#0a0a0a !important; }}
  .v-card {{ background-color:#171717 !important; }}
  .v-text {{ color:#f5f5f5 !important; }}
  .v-muted {{ color:#a3a3a3 !important; }}
  .v-link {{ color:{_ACCENT_TEXT_DARK} !important; }}
}}
</style>
</head>
<body class="v-bg" style="margin:0;padding:0;background-color:#f4f2ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="v-bg" \
bgcolor="#f4f2ef" style="background-color:#f4f2ef;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" \
style="width:100%;max-width:600px;">
<tr><td style="padding:0 4px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0 10px 0 0;"><img src="{logo}" width="32" height="32" alt="" \
style="display:block;border:0;"></td>
<td class="v-text" style="font-family:{_FONT};font-size:20px;font-weight:700;color:#232323;">\
Vidit</td>
</tr></table>
</td></tr>
<tr><td class="v-card" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px;\
padding:32px 28px;">
<h1 class="v-text" style="margin:0 0 20px;font-family:{_FONT};font-size:20px;line-height:28px;\
font-weight:700;color:#232323;">{html.escape(content.heading)}</h1>
{body}
</td></tr>
<tr><td class="v-muted" style="padding:16px 4px;font-family:{_FONT};font-size:12px;\
line-height:18px;color:#737373;">{footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""
