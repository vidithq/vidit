from app.main import app


def test_the_spec_lists_every_error_code_family():
    schemas = app.openapi()["components"]["schemas"]
    codes = set(schemas["ErrorCode"]["enum"])
    assert {
        "event_not_found",
        "snapshot_url_too_long",
        "link_has_no_file",
        "upstream_unreadable",
        "lock_timeout",
        "read_quota_exceeded",
        "archive_no_tweets",
    } <= codes
    detail = schemas["CodedErrorResponse"]["properties"]["detail"]["$ref"]
    assert schemas[detail.rsplit("/", 1)[1]]["properties"]["code"] == {
        "$ref": "#/components/schemas/ErrorCode"
    }
