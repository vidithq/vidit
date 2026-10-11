import time
from html.parser import HTMLParser
from urllib.parse import urlparse

import pytest

from app.config import settings
from app.services.sanitize import (
    extract_image_srcs,
    extract_link_hrefs,
    html_from_text,
    html_text,
    rewrite_image_srcs,
    sanitize_html,
)


@pytest.fixture
def dev_media(monkeypatch):
    """The local-storage dev shape: no CDN, so any https image passes."""
    monkeypatch.setattr(settings, "cloudfront_domain", "")
    monkeypatch.setattr(settings, "storage_backend", "local")


# --- allowlist ---------------------------------------------------------------


def test_empty_body_stays_empty():
    assert sanitize_html("") == ""


def test_allowed_tags_survive_unchanged(dev_media):
    html = (
        "<h2>Title</h2><h3>Sub</h3>"
        "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code><br>next</p>"
        '<p><a href="https://example.com/x">link</a></p>'
        "<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>"
        "<blockquote><p>quote</p></blockquote><pre><code>a\n  b</code></pre><hr>"
        '<img src="https://media.example.com/a.png" alt="frame">'
    )
    assert sanitize_html(html) == html


def test_unknown_tags_unwrap_and_keep_their_text():
    assert sanitize_html("<h1>t</h1><div>d</div><u>u</u><span>s</span>") == "tdus"


def test_unknown_attributes_drop():
    html = '<p class="x" style="color:red" id="y" data-x="1" title="t" lang="en">t</p>'
    assert sanitize_html(html) == "<p>t</p>"


def test_link_keeps_only_href():
    html = '<a href="https://e.example" target="_blank" rel="opener" title="t">l</a>'
    assert sanitize_html(html) == '<a href="https://e.example">l</a>'


def test_list_items_keep_their_paragraphs():
    html = "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>"
    assert sanitize_html(html) == html


def test_malformed_markup_is_repaired():
    assert sanitize_html("<p>a<p>b<strong>c") == "<p>a</p><p>b<strong>c</strong></p>"


def test_sanitising_is_idempotent(dev_media):
    html = '<p>x <a href="https://e.example/?a=1&amp;b=2">y</a></p><img src="/m.png" alt="a>b">'
    once = sanitize_html(html)
    assert sanitize_html(once) == once


# --- XSS corpus ---------------------------------------------------------------

_ALLOWED: dict[str, set[str]] = {
    **{
        t: set()
        for t in [
            "p",
            "h2",
            "h3",
            "strong",
            "em",
            "s",
            "code",
            "pre",
            "ul",
            "ol",
            "li",
            "blockquote",
            "hr",
            "br",
        ]
    },
    "a": {"href"},
    "img": {"src", "alt"},
}


def _tags(html: str) -> list[tuple[str, dict[str, str | None]]]:
    """Every start tag of ``html`` with its attributes, as a browser would read them."""
    found: list[tuple[str, dict[str, str | None]]] = []

    class Collector(HTMLParser):
        def handle_starttag(self, tag, attrs):
            found.append((tag, dict(attrs)))

    collector = Collector()
    collector.feed(html)
    collector.close()
    return found


@pytest.mark.parametrize(
    "payload",
    [
        "<script>alert(1)</script>",
        "<style>body{background:url(javascript:alert(1))}</style>",
        '<img src="x" onerror="alert(1)">',
        "<svg onload=alert(1)><circle/></svg>",
        "<svg><script>alert(1)</script></svg>",
        "<math><mtext><script>alert(1)</script></mtext></math>",
        '<iframe src="https://evil.example"></iframe>',
        '<form action="javascript:alert(1)"><button>x</button></form>',
        '<a href="javascript:alert(1)">x</a>',
        '<a href="JaVaScRiPt:alert(1)">x</a>',
        '<a href=" javascript:alert(1)">x</a>',
        '<a href="java\tscript:alert(1)">x</a>',
        '<img src="javascript:alert(1)">',
        '<img src="//evil.example/pixel.gif">',
        '<img src="/\\evil.example/pixel.gif">',
        '<img src="/\t/evil.example/pixel.gif">',
        '<p style="background:url(https://evil.example/p.gif)">x</p>',
        "<!--<script>alert(1)</script>-->",
        "<<script>script>alert(1)<</script>/script>",
        '<a href="https://ok.example"><img src=x onerror=alert(1)>',
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
        '<textarea><img src=x onerror="alert(1)"></textarea>',
    ],
)
def test_xss_payloads_leave_only_allowlisted_markup(payload, monkeypatch):
    monkeypatch.setattr(settings, "cloudfront_domain", "cdn.example.com")
    tags = _tags(sanitize_html(payload))
    for tag, attrs in tags:
        assert tag in _ALLOWED, tag
        assert set(attrs) <= _ALLOWED[tag], (tag, attrs)
        if tag == "a":
            assert urlparse(attrs["href"]).scheme in {"http", "https"}
        if tag == "img":
            assert urlparse(attrs["src"]).hostname == "cdn.example.com"


def test_script_and_style_content_is_dropped():
    assert sanitize_html("<script>alert(1)</script><style>p{}</style><p>t</p>") == "<p>t</p>"


# --- links ------------------------------------------------------------------------


def test_refused_link_becomes_text():
    html = '<p><a href="javascript:alert(1)">a<strong>b</strong></a> c</p>'
    assert sanitize_html(html) == "<p>a<strong>b</strong> c</p>"


@pytest.mark.parametrize(
    "href", ["mailto:x@example.com", "/relative", "example.com", "placeholder://x"]
)
def test_non_http_links_become_text(href):
    assert sanitize_html(f'<a href="{href}">t</a>', allow_placeholders=True) == "t"


def test_http_and_https_links_pass():
    html = '<a href="http://a.example/">a</a><a href="https://b.example/x?y=1&amp;z=2">b</a>'
    assert sanitize_html(html) == html


# --- images and media host rules ---------------------------------------------


def test_refused_image_is_removed_not_left_bare():
    html = '<p>x</p><img src="javascript:alert(1)" alt="kept?"><p>y</p>'
    assert sanitize_html(html) == "<p>x</p><p>y</p>"


@pytest.mark.parametrize("html", ['<img alt="a"><img>', '<img alt="x src=">'])
def test_image_without_src_is_removed(html):
    assert sanitize_html(html) == ""


def test_markup_characters_in_an_attribute_value_keep_the_image():
    out = sanitize_html('<img alt="a>b" src="/m.png">')
    assert out == '<img alt="a&gt;b" src="/m.png">'
    assert extract_image_srcs(out) == ["/m.png"]


def test_relative_image_passes():
    assert sanitize_html('<img src="/media/a.png">') == '<img src="/media/a.png">'


def test_allow_images_false_drops_images_and_keeps_text(dev_media):
    html = '<p>words</p><img src="https://m.example/a.png"><p>more</p>'
    assert sanitize_html(html, allow_images=False) == "<p>words</p><p>more</p>"


def test_http_image_dropped_https_only(dev_media):
    assert sanitize_html('<img src="http://m.example/a.png">') == ""


def test_image_off_cdn_dropped_when_cdn_configured(monkeypatch):
    monkeypatch.setattr(settings, "cloudfront_domain", "cdn.example.com")
    html = '<img src="https://cdn.example.com/a.png"><img src="https://other.example/a.png">'
    assert sanitize_html(html) == '<img src="https://cdn.example.com/a.png">'


def test_image_any_https_passes_when_no_cdn(dev_media):
    assert sanitize_html('<img src="https://m.example/a.png">') == (
        '<img src="https://m.example/a.png">'
    )


def test_local_storage_url_passes_in_dev(dev_media):
    from app.services.storage import LOCAL_STORAGE_URL_PREFIX

    html = f'<img src="{LOCAL_STORAGE_URL_PREFIX}/proof/u/a.png">'
    assert sanitize_html(html) == html


def test_image_src_pinned_to_s3_bucket_when_no_cdn(monkeypatch):
    monkeypatch.setattr(settings, "cloudfront_domain", "")
    monkeypatch.setattr(settings, "storage_backend", "s3")
    monkeypatch.setattr(settings, "s3_bucket", "vidit-prod")
    monkeypatch.setattr(settings, "aws_region", "eu-west-3")
    bucket = '<img src="https://vidit-prod.s3.eu-west-3.amazonaws.com/proof/a.png">'
    html = bucket + '<img src="https://attacker.example/pixel.gif">'
    assert sanitize_html(html) == bucket


# --- placeholders -------------------------------------------------------------


def test_placeholder_src_needs_the_flag():
    html = '<img src="placeholder://a.png">'
    assert sanitize_html(html) == ""
    assert sanitize_html(html, allow_placeholders=True) == html


def test_placeholder_filename_with_spaces_and_markup_chars_survives():
    html = '<img src="placeholder://Screen Shot 2026 (1) &amp; &quot;x&quot;.png">'
    out = sanitize_html(html, allow_placeholders=True)
    assert out == html
    assert extract_image_srcs(out) == ['placeholder://Screen Shot 2026 (1) & "x".png']


def test_bare_placeholder_prefix_is_dropped():
    assert sanitize_html('<img src="placeholder://">', allow_placeholders=True) == ""


def test_placeholder_text_outside_an_image_is_kept_verbatim():
    html = "<p>see placeholder://x.png</p>"
    assert sanitize_html(html, allow_placeholders=True) == html


def test_rewrite_image_srcs_swaps_placeholders_for_stored_urls(dev_media):
    body = sanitize_html(
        '<p>x</p><img src="placeholder://a b.png"><img src="https://m.example/kept.png">',
        allow_placeholders=True,
    )
    out = rewrite_image_srcs(body, {"placeholder://a b.png": "https://m.example/new.png"})
    assert (
        out == '<p>x</p><img src="https://m.example/new.png"><img src="https://m.example/kept.png">'
    )


# --- caps -----------------------------------------------------------------------


def test_excessive_tag_count_rejected_before_parsing():
    with pytest.raises(ValueError, match="max tag count"):
        sanitize_html("<p>x</p>" * 6_000)


def test_deep_nesting_rejected_but_nested_lists_pass():
    assert sanitize_html("<ul><li><p>" * 10 + "x" + "</p></li></ul>" * 10)
    with pytest.raises(ValueError, match="max nesting depth"):
        sanitize_html("<blockquote>" * 40 + "x" + "</blockquote>" * 40)


def test_distinct_formatting_tags_rejected_before_parsing():
    # Each distinct unclosed tag is reopened in every block: unbounded, this
    # 50 KB body built 4.5 million nodes (1.2 GB, 1.6 s) in the parser.
    html = "<p>" + "".join(f"<font a={i}>" for i in range(3000)) + "</p>" + "<p>x</p>" * 1500
    started = time.perf_counter()
    with pytest.raises(ValueError, match="max distinct formatting tags"):
        sanitize_html(html)
    assert time.perf_counter() - started < 0.1


def test_repeated_formatting_tags_count_once():
    code = '<pre><code class="language-text" data-language="text">x</code></pre>'
    html = "<p>" + "<strong>a</strong><em>b</em><code>c</code>" * 100 + "</p>" + code * 50
    assert sanitize_html(html)


@pytest.mark.parametrize(
    "tag",
    [
        '<font a=">{i}">',  # a quoted ``>`` does not end the tag
        "<font a={i}>",
        "<FONT a={i}>",
        "<b\na={i}>",
        "<i/a={i}>",
    ],
)
def test_each_distinct_formatting_spelling_counts(tag):
    sanitize_html("".join(tag.format(i=i) for i in range(16)))
    with pytest.raises(ValueError, match="max distinct formatting tags"):
        sanitize_html("".join(tag.format(i=i) for i in range(17)))


def test_excessive_length_rejected():
    with pytest.raises(ValueError, match="max length"):
        sanitize_html("x" * 200_001)


# --- extraction -------------------------------------------------------------------


def test_extract_image_srcs_in_order_and_deduped():
    html = '<img src="/a.png"><ul><li><img src="/b.png"></li></ul><img src="/a.png"><img alt="x">'
    assert extract_image_srcs(html) == ["/a.png", "/b.png"]


def test_extract_link_hrefs_in_order_and_decoded():
    html = '<a href="https://a.example">a</a><a href="http://b.example/?x=1&amp;y=2">d</a>'
    assert extract_link_hrefs(html) == ["https://a.example", "http://b.example/?x=1&y=2"]


# --- text projection ------------------------------------------------------------


def test_text_joins_paragraphs_with_one_newline():
    assert html_text("<p>one</p><p>two</p>") == "one\ntwo"


def test_text_concatenates_the_runs_of_one_paragraph():
    assert html_text("<p>a <strong>b</strong><em>c</em> <a href='https://x.example'>d</a></p>") == (
        "a bc d"
    )


def test_text_gives_each_list_item_its_own_line():
    assert html_text("<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li>c</li></ol>") == (
        "a\nb\nc"
    )


def test_text_breaks_a_line_at_headings_quotes_rules_and_breaks():
    html = "<h2>h</h2><blockquote><p>q</p></blockquote>x<br>y<hr>z<pre><code>c</code></pre>"
    assert html_text(html) == "h\nq\nx\ny\nz\nc"


def test_text_drops_blank_lines_and_strips():
    assert html_text("<p>  a  </p><p> </p><p></p><br><p>b</p>") == "a\nb"


def test_text_decodes_entities():
    assert html_text("<p>a &amp; &lt;b&gt; &quot;c&quot;</p>") == 'a & <b> "c"'


def test_text_of_an_empty_body_is_empty():
    assert html_text("") == ""


def test_text_ignores_images():
    assert html_text('<p>a</p><img src="/x.png" alt="alt text"><p>b</p>') == "a\nb"


# --- html_from_text ---------------------------------------------------------------


def test_from_text_writes_one_paragraph_per_non_blank_line():
    assert html_from_text("a & <b>\n\n  c  \n") == "<p>a &amp; &lt;b&gt;</p><p>  c  </p>"


def test_from_text_of_blank_input_is_empty():
    assert html_from_text(" \n\n") == ""


def test_from_text_appends_images_and_stays_canonical(dev_media):
    out = html_from_text("caption", image_srcs=["https://m.example/a.png"])
    assert out == '<p>caption</p><img src="https://m.example/a.png">'
    assert sanitize_html(out) == out


def test_from_text_keeps_minted_srcs_off_the_media_host(monkeypatch):
    monkeypatch.setattr(settings, "cloudfront_domain", "cdn.example.com")
    out = html_from_text("a", image_srcs=["https://bucket.example/p.png?x=1&y=2"])
    assert out == '<p>a</p><img src="https://bucket.example/p.png?x=1&amp;y=2">'
    assert extract_image_srcs(out) == ["https://bucket.example/p.png?x=1&y=2"]


def test_text_reverses_from_text():
    assert html_text(html_from_text("one\n\ntwo\nthree")) == "one\ntwo\nthree"


def test_text_splits_preformatted_lines():
    assert html_text("<pre><code>a\n  b\n\nc</code></pre>") == "a\nb\nc"


def test_sanitising_drops_the_object_replacement_character():
    assert sanitize_html("<p>a\ufffcb</p>") == "<p>ab</p>"


@pytest.mark.parametrize(
    "html", ["<p></p>", "<p>\ufffc</p>", "<p> &nbsp;</p><hr><br>", "<ul><li></li></ul>"]
)
def test_a_body_without_text_or_image_is_empty(html):
    assert sanitize_html(html) == ""


def test_a_body_with_only_an_image_is_kept():
    assert sanitize_html('<p></p><img src="/a.png">') == '<p></p><img src="/a.png">'
