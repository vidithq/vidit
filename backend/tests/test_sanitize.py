import pytest

from app.config import settings
from app.services.sanitize import (
    _MAX_DEPTH,
    _MAX_NODES,
    extract_image_srcs,
    sanitize_tiptap_doc,
)


def test_empty_doc_passes():
    doc = {"type": "doc", "content": []}
    assert sanitize_tiptap_doc(doc) == {"type": "doc", "content": []}


def test_simple_paragraph_passes():
    doc = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hello"}]}],
    }
    assert sanitize_tiptap_doc(doc) == doc


def test_unknown_node_type_dropped():
    doc = {
        "type": "doc",
        "content": [
            {"type": "iframe", "attrs": {"src": "evil.com"}},
            {"type": "paragraph", "content": [{"type": "text", "text": "ok"}]},
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == [
        {"type": "paragraph", "content": [{"type": "text", "text": "ok"}]}
    ]


def test_unknown_mark_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "x",
                        "marks": [
                            {"type": "bold"},
                            {"type": "underline"},
                        ],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["content"][0]["marks"] == [{"type": "bold"}]


def test_unknown_attr_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 2, "onclick": "alert(1)"},
                "content": [{"type": "text", "text": "x"}],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["attrs"] == {"level": 2}


def test_heading_level_out_of_range_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 99},
                "content": [{"type": "text", "text": "x"}],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    # level dropped, attrs becomes empty, attrs key omitted
    assert "attrs" not in cleaned["content"][0]


def test_image_javascript_url_drops_node():
    doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {"src": "javascript:alert(1)"}},
            {"type": "paragraph", "content": [{"type": "text", "text": "after"}]},
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == [
        {"type": "paragraph", "content": [{"type": "text", "text": "after"}]}
    ]


def test_image_relative_url_passes():
    doc = {
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "/uploads/x.png"}}],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["attrs"]["src"] == "/uploads/x.png"


def test_allow_images_false_drops_images_keeps_text():
    """A request's proof sanitises with allow_images=False: an otherwise-valid
    image is dropped (no proof_files ride the request path to anchor it) while
    the surrounding text survives."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Lead on the depot."}],
            },
            {"type": "image", "attrs": {"src": "/uploads/x.png"}},
        ],
    }
    cleaned = sanitize_tiptap_doc(doc, allow_images=False)
    assert cleaned["content"] == [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": "Lead on the depot."}],
        }
    ]


def test_data_url_image_dropped():
    doc = {
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "data:image/svg+xml,<svg/>"}}],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == []


def test_http_image_dropped_https_only():
    """Plain http:// is rejected — only https or relative paths pass."""
    doc = {
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "http://example.com/x.png"}}],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == []


def test_image_protocol_relative_url_dropped():
    """Protocol-relative ``//evil.com/x.gif`` must NOT slip through the
    ``startswith("/")`` early-return: the browser resolves it against
    the page's scheme and turns it into an outbound request to an
    arbitrary host. Without this guard the sanitiser leaks every
    viewer's IP/UA/Referer through a persisted tracking pixel."""
    doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {"src": "//attacker.example/pixel.gif"}},
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == []


def test_image_off_cdn_dropped_when_cdn_configured(monkeypatch):
    """With cloudfront_domain set, only that host's https URLs are allowed."""
    monkeypatch.setattr(settings, "cloudfront_domain", "cdn.example.com")
    doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {"src": "https://attacker.com/track.gif"}},
            {"type": "image", "attrs": {"src": "https://cdn.example.com/ok.jpg"}},
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == [
        {"type": "image", "attrs": {"src": "https://cdn.example.com/ok.jpg"}}
    ]


def test_image_any_https_passes_when_no_cdn(monkeypatch):
    """In dev with no CDN configured, any https:// image src is allowed."""
    monkeypatch.setattr(settings, "cloudfront_domain", "")
    doc = {
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "https://example.com/x.png"}}],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["attrs"]["src"] == "https://example.com/x.png"


def test_local_storage_url_passes_in_dev(monkeypatch):
    """In dev (no CDN, local backend), the http://localhost local-storage
    prefix is allowed so editor-uploaded proof images survive
    sanitization end-to-end."""
    monkeypatch.setattr(settings, "cloudfront_domain", "")
    monkeypatch.setattr(settings, "storage_backend", "local")
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {"src": "http://localhost:8000/local-storage/proof/u/abc.png"},
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert (
        cleaned["content"][0]["attrs"]["src"]
        == "http://localhost:8000/local-storage/proof/u/abc.png"
    )


def test_local_storage_url_dropped_when_backend_is_s3(monkeypatch):
    """The dev escape requires both no-CDN AND local backend. A misconfigured
    staging env (CDN-less but S3-backed) must NOT accept loopback URLs."""
    monkeypatch.setattr(settings, "cloudfront_domain", "")
    monkeypatch.setattr(settings, "storage_backend", "s3")
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {"src": "http://localhost:8000/local-storage/proof/u/abc.png"},
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == []


def test_local_storage_url_dropped_in_prod(monkeypatch):
    """The dev escape hatch is disabled when a CloudFront host is set."""
    monkeypatch.setattr(settings, "cloudfront_domain", "cdn.example.com")
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {"src": "http://localhost:8000/local-storage/proof/u/abc.png"},
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"] == []


def test_link_mark_javascript_href_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [
                            {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
                        ],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    # link mark dropped, no marks key remaining
    assert "marks" not in cleaned["content"][0]["content"][0]


def test_link_mark_https_href_passes():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [
                            {"type": "link", "attrs": {"href": "https://example.com"}},
                        ],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["content"][0]["marks"] == [
        {"type": "link", "attrs": {"href": "https://example.com"}}
    ]


def test_link_mark_strips_unknown_attrs():
    """Only href and (optionally) target survive on a link mark."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [
                            {
                                "type": "link",
                                "attrs": {
                                    "href": "https://example.com",
                                    "target": "_blank",
                                    "onclick": "alert(1)",
                                    "rel": "evil",
                                },
                            },
                        ],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    mark = cleaned["content"][0]["content"][0]["marks"][0]
    assert mark == {
        "type": "link",
        "attrs": {"href": "https://example.com", "target": "_blank"},
    }


def test_link_mark_invalid_target_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [
                            {
                                "type": "link",
                                "attrs": {
                                    "href": "https://example.com",
                                    "target": "_javascript_window_",
                                },
                            },
                        ],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    mark = cleaned["content"][0]["content"][0]["marks"][0]
    assert "target" not in mark["attrs"]


def test_link_mark_schemeless_href_dropped():
    """Schemeless URLs ('example.com') would render as relative paths in
    a browser — not a link off-site. Reject."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [{"type": "link", "attrs": {"href": "example.com"}}],
                    }
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert "marks" not in cleaned["content"][0]["content"][0]


def test_root_must_be_doc():
    with pytest.raises(ValueError, match="type='doc'"):
        sanitize_tiptap_doc({"type": "paragraph"})


def test_non_dict_input_raises():
    with pytest.raises(ValueError):
        sanitize_tiptap_doc("not a doc")


def test_nested_unknown_nodes_dropped():
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "blockquote",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "ok"}]},
                    {"type": "script", "content": [{"type": "text", "text": "evil"}]},
                ],
            }
        ],
    }
    cleaned = sanitize_tiptap_doc(doc)
    assert cleaned["content"][0]["content"] == [
        {"type": "paragraph", "content": [{"type": "text", "text": "ok"}]}
    ]


def test_excessive_depth_rejected():
    """Deeply nested blockquotes blow the cap."""
    inner: dict = {"type": "paragraph", "content": [{"type": "text", "text": "x"}]}
    for _ in range(_MAX_DEPTH + 5):
        inner = {"type": "blockquote", "content": [inner]}
    doc = {"type": "doc", "content": [inner]}
    with pytest.raises(ValueError, match="max depth"):
        sanitize_tiptap_doc(doc)


def test_extract_image_srcs_walks_nested_blocks_and_dedupes():
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "intro"}]},
            {
                "type": "image",
                "attrs": {"src": "https://cdn.example.com/a.jpg"},
            },
            {
                "type": "blockquote",
                "content": [
                    {"type": "image", "attrs": {"src": "https://cdn.example.com/b.jpg"}},
                    {
                        "type": "image",
                        "attrs": {"src": "https://cdn.example.com/a.jpg"},  # dup
                    },
                ],
            },
        ],
    }
    assert extract_image_srcs(doc) == [
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/b.jpg",
    ]


def test_extract_image_srcs_ignores_image_without_src():
    doc = {
        "type": "doc",
        "content": [
            {"type": "image", "attrs": {}},
            {"type": "image"},
            {"type": "image", "attrs": {"src": 42}},
        ],
    }
    assert extract_image_srcs(doc) == []


def test_excessive_node_count_rejected():
    """A flat blob of N+1 paragraphs trips the node-count cap."""
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "."}]}
            for _ in range(_MAX_NODES + 10)
        ],
    }
    with pytest.raises(ValueError, match="max node count"):
        sanitize_tiptap_doc(doc)
