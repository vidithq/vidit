"""event sources

Revision ID: fb4098ed6742
Revises: 4c85d28351c8
Create Date: 2026-10-24 18:00:00.000000

An event's evidence moves to ``sources``: each source holds its level, kind, capture time,
capture position, graphic flag, file (``media.source_id``), URLs (``source_links``, with the
archived copy of each) and tags (``source_tags``). ``uploads`` stages a source file before the
event write that references it.

Data mapping:

* An event with a ``source_url`` or a source file gets one ``direct`` source: its kind is the
  event's capture-source tag (else ``unknown``), its file the source media row, its capture
  position ``capture_source_coords``, its graphic flag the event's, and its one link
  ``source_url`` with ``source_posted_at`` and that URL's archived copy.
* Each ``event_source_links`` row becomes its own ``direct`` source, kind ``unknown``, no
  file, one link with its archived copy.
* Archived copies of the detection post and of proof links are dropped.
* Version snapshots are rewritten to the ``sources`` shape with the same content.
* The ``capture_source`` tags go (their names became kinds), then ``tags.category``.

The downgrade maps each event back onto one source: the first source with a file (else the
first source) gives ``source_url``, its first link's post time, its capture position, its
capture-source tag and its file; every other link becomes a secondary link (ten at most), and
the other sources' files are deleted. A kind with no capture-source tag (``camera``,
``article``, ``official_statement``, ``other``) comes back as ``Unknown``. It restores what
the upgrade wrote, except that an event that carried no capture-source tag comes back with
``Unknown``.
"""

import json
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "fb4098ed6742"
down_revision: Union[str, None] = "4c85d28351c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Capture-source tag names and the source kind each became. Frozen here so a later change to
# the model cannot alter this migration.
KIND_OF_TAG = {
    "Smartphone": "smartphone",
    "Satellite": "satellite",
    "Drone": "drone",
    "Static camera": "static_camera",
    "Dashcam": "dashcam",
    "Body / helmet cam": "body_cam",
    "Unknown": "unknown",
}
TAG_OF_KIND = {kind: name for name, kind in KIND_OF_TAG.items()}
# Every source kind, in ``models/source.SourceKind`` order.
SOURCE_KINDS = (
    "smartphone",
    "camera",
    "static_camera",
    "drone",
    "satellite",
    "dashcam",
    "body_cam",
    "article",
    "official_statement",
    "other",
    "unknown",
)
MAX_SECONDARY_LINKS = 10

_KIND_CASE = "CASE t.name " + " ".join(
    f"WHEN '{name}' THEN '{kind}'" for name, kind in KIND_OF_TAG.items()
) + " ELSE 'unknown' END"

_PROVIDER_CASE = (
    "CASE WHEN {col} LIKE 'https://web.archive.org/%' THEN 'wayback' "
    "WHEN {col} LIKE 'https://ghostarchive.org/%' THEN 'ghostarchive' "
    "ELSE 'archive_today' END"
)


def _provider(snapshot_url: str) -> str:
    if snapshot_url.startswith("https://web.archive.org/"):
        return "wayback"
    if snapshot_url.startswith("https://ghostarchive.org/"):
        return "ghostarchive"
    return "archive_today"


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), server_default=sa.text("''"), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "capture_position",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
        sa.Column("is_graphic", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "level IN ('direct', 'indirect', 'context')", name="ck_sources_level_valid"
        ),
        sa.CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in SOURCE_KINDS) + ")",
            name="ck_sources_kind_valid",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sources_event_id", "sources", ["event_id"])
    op.create_index(
        "ix_sources_search_fts",
        "sources",
        [sa.text("to_tsvector('simple', coalesce(title, ''))")],
        postgresql_using="gin",
    )
    op.create_table(
        "source_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("snapshot_url", sa.Text(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(snapshot_url IS NULL) = (archived_at IS NULL)", name="ck_source_links_archive_stamp"
        ),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "url", name="uq_source_links_source_url"),
    )
    op.create_table(
        "source_tags",
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("source_id", "tag_id"),
    )
    op.create_index("ix_source_tags_tag_id", "source_tags", ["tag_id"])
    op.create_table(
        "uploads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("uploader_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('image', 'video')", name="ck_uploads_kind_valid"),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uploads_uploader_id", "uploads", ["uploader_id"])
    op.create_index("ix_uploads_expires_at", "uploads", ["expires_at"])

    op.add_column("media", sa.Column("source_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "media_source_id_fkey", "media", "sources", ["source_id"], ["id"], ondelete="CASCADE"
    )
    op.create_unique_constraint("uq_media_source_id", "media", ["source_id"])
    op.alter_column("media", "event_id", nullable=True)

    # One ``direct`` source per event with a source URL or a source file. Its ``created_at``
    # is the event's, so it sorts ahead of the sources the secondary links become.
    op.execute(
        """
        CREATE TEMPORARY TABLE main_sources ON COMMIT DROP AS
        SELECT e.id AS event_id, gen_random_uuid() AS source_id
        FROM events e
        WHERE e.source_url IS NOT NULL
           OR EXISTS (SELECT 1 FROM media m WHERE m.event_id = e.id AND m.role = 'source')
        """
    )
    op.execute(
        f"""
        INSERT INTO sources (id, event_id, title, level, kind, captured_at, capture_position,
                             is_graphic, created_at, updated_at)
        SELECT ms.source_id, e.id, '', 'direct',
               COALESCE((
                   SELECT {_KIND_CASE}
                   FROM event_tags et JOIN tags t ON t.id = et.tag_id
                   WHERE et.event_id = e.id AND t.category = 'capture_source'
                   ORDER BY t.name = 'Unknown', t.name
                   LIMIT 1
               ), 'unknown'),
               NULL, e.capture_source_coords, e.is_graphic, e.created_at, e.updated_at
        FROM main_sources ms JOIN events e ON e.id = ms.event_id
        """
    )
    op.execute(
        """
        INSERT INTO source_links (id, source_id, url, posted_at, snapshot_url, archived_at,
                                  created_at)
        SELECT gen_random_uuid(), ms.source_id, e.source_url, e.source_posted_at,
               a.snapshot_url, a.created_at, e.created_at
        FROM main_sources ms
        JOIN events e ON e.id = ms.event_id
        LEFT JOIN source_archives a ON a.event_id = e.id AND a.original_url = e.source_url
        WHERE e.source_url IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE media m SET source_id = ms.source_id, event_id = NULL
        FROM main_sources ms
        WHERE m.event_id = ms.event_id AND m.role = 'source'
        """
    )
    # Each secondary link becomes its own source, after the main one and in link order.
    op.execute(
        """
        CREATE TEMPORARY TABLE link_sources ON COMMIT DROP AS
        SELECT l.event_id, l.position, l.url, gen_random_uuid() AS source_id
        FROM event_source_links l
        """
    )
    op.execute(
        """
        INSERT INTO sources (id, event_id, title, level, kind, is_graphic, created_at,
                             updated_at)
        SELECT ls.source_id, e.id, '', 'direct', 'unknown', false,
               e.created_at + (ls.position + 1) * interval '1 microsecond', e.updated_at
        FROM link_sources ls JOIN events e ON e.id = ls.event_id
        """
    )
    op.execute(
        """
        INSERT INTO source_links (id, source_id, url, posted_at, snapshot_url, archived_at,
                                  created_at)
        SELECT gen_random_uuid(), ls.source_id, ls.url, NULL, a.snapshot_url, a.created_at,
               s.created_at
        FROM link_sources ls
        JOIN sources s ON s.id = ls.source_id
        LEFT JOIN source_archives a ON a.event_id = ls.event_id AND a.original_url = ls.url
        """
    )

    bind = op.get_bind()
    for version_id, snapshot in bind.execute(
        sa.text("SELECT id, snapshot FROM event_versions WHERE snapshot <> '{}'::jsonb")
    ).all():
        bind.execute(
            sa.text("UPDATE event_versions SET snapshot = :snapshot WHERE id = :id"),
            {"snapshot": json.dumps(_sources_snapshot(snapshot)), "id": version_id},
        )

    op.execute("DELETE FROM tags WHERE category = 'capture_source'")
    op.drop_constraint("ck_tags_category_valid", "tags", type_="check")
    op.drop_column("tags", "category")

    op.drop_index("ix_source_archives_event_id", table_name="source_archives")
    op.drop_table("source_archives")
    op.drop_table("event_source_links")
    op.drop_constraint("ck_events_source_url_status", "events", type_="check")
    op.drop_column("events", "source_url")
    op.drop_column("events", "capture_source_coords")
    op.drop_column("events", "source_posted_at")
    op.drop_column("events", "is_graphic")

    op.drop_index("uq_media_source_per_event", table_name="media")
    op.drop_constraint("ck_media_role_valid", "media", type_="check")
    op.drop_column("media", "role")
    op.create_check_constraint(
        "ck_media_one_parent", "media", "num_nonnulls(source_id, event_id) = 1"
    )
    op.create_index("ix_media_storage_url", "media", ["storage_url"])


def _sources_snapshot(old: dict[str, Any]) -> dict[str, Any]:
    """One version snapshot in the ``sources`` shape, same content."""
    archives = {
        a["original_url"]: a for a in old.get("archives") or [] if isinstance(a, dict)
    }

    def link(url: str, posted_at: Any) -> dict[str, Any]:
        archive = archives.get(url)
        return {
            "url": url,
            "posted_at": posted_at,
            "snapshot_url": archive["snapshot_url"] if archive else None,
            "archived_at": archive["created_at"] if archive else None,
        }

    tags = [t for t in old.get("tags") or [] if isinstance(t, dict)]
    capture = sorted(
        (t["name"] for t in tags if t.get("category") == "capture_source"),
        key=lambda name: (name == "Unknown", name),
    )
    sources: list[dict[str, Any]] = []
    source_url = old.get("source_url")
    source_media = [m for m in old.get("source_media") or [] if isinstance(m, dict)]
    if source_url or source_media:
        sources.append(
            {
                "title": "",
                "level": "direct",
                "kind": KIND_OF_TAG.get(capture[0], "unknown") if capture else "unknown",
                "captured_at": None,
                "capture_position": old.get("capture_source_coords"),
                "is_graphic": bool(old.get("is_graphic", False)),
                "links": [link(source_url, old.get("source_posted_at"))] if source_url else [],
                "tags": [],
                "media": source_media[0] if source_media else None,
            }
        )
    for url in old.get("secondary_source_urls") or []:
        sources.append(
            {
                "title": "",
                "level": "direct",
                "kind": "unknown",
                "captured_at": None,
                "capture_position": None,
                "is_graphic": False,
                "links": [link(url, None)],
                "tags": [],
                "media": None,
            }
        )
    new = {
        key: value
        for key, value in old.items()
        if key
        not in (
            "source_url",
            "source_media",
            "capture_source_coords",
            "source_posted_at",
            "is_graphic",
            "secondary_source_urls",
            "archives",
            "tags",
            "proof_media",
        )
    }
    new["tags"] = [
        {"id": t["id"], "name": t["name"]} for t in tags if t.get("category") != "capture_source"
    ]
    if "proof_media" in old:
        new["proof_media"] = old.get("proof_media") or []
    new["sources"] = sources
    return new


def _legacy_snapshot(new: dict[str, Any], tag_ids: dict[str, str]) -> dict[str, Any]:
    """The inverse of :func:`_sources_snapshot`."""
    sources = [s for s in new.get("sources") or [] if isinstance(s, dict)]
    primary = next((s for s in sources if s.get("media")), sources[0] if sources else None)
    links = [
        (source, link)
        for source in ([primary] if primary else []) + [s for s in sources if s is not primary]
        for link in source.get("links") or []
    ]
    source_link = links[0][1] if links and links[0][0] is primary else None
    source_url = source_link["url"] if source_link else None
    secondary: list[str] = []
    for _source, link in links:
        url = link["url"]
        if url != source_url and url not in secondary and len(secondary) < MAX_SECONDARY_LINKS:
            secondary.append(url)
    old = {key: value for key, value in new.items() if key not in ("sources", "tags")}
    old["source_url"] = source_url
    media = primary.get("media") if primary else None
    old["source_media"] = [media] if media else []
    old["capture_source_coords"] = primary.get("capture_position") if primary else None
    old["source_posted_at"] = source_link.get("posted_at") if source_link else None
    old["is_graphic"] = any(bool(s.get("is_graphic")) for s in sources)
    old["secondary_source_urls"] = secondary
    tags = [{**t, "category": "free"} for t in new.get("tags") or [] if isinstance(t, dict)]
    kind = primary.get("kind") if primary else None
    if kind:
        name = TAG_OF_KIND.get(kind, "Unknown")
        tags.append({"id": tag_ids[name], "name": name, "category": "capture_source"})
    old["tags"] = tags
    if "proof_media" in new:
        old["proof_media"] = new.get("proof_media") or []
    kept = {url for url in [source_url, *secondary] if url}
    archived: dict[str, dict[str, Any]] = {}
    for source, link in links:
        url = link["url"]
        if url in kept and link.get("snapshot_url") and url not in archived:
            archived[url] = {
                "original_url": url,
                "origin": "source_url" if url == source_url else "secondary_source",
                "snapshot_url": link["snapshot_url"],
                "provider": _provider(link["snapshot_url"]),
                "created_at": link.get("archived_at"),
            }
    old["archives"] = [archived[url] for url in sorted(archived)]
    return old


def downgrade() -> None:
    op.drop_index("ix_media_storage_url", table_name="media")
    op.drop_constraint("ck_media_one_parent", "media", type_="check")
    op.add_column("media", sa.Column("role", sa.String(length=10), nullable=True))
    op.add_column(
        "events",
        sa.Column("is_graphic", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "events", sa.Column("source_posted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "events",
        sa.Column(
            "capture_source_coords",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
    )
    op.add_column("events", sa.Column("source_url", sa.Text(), nullable=True))
    op.create_table(
        "event_source_links",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "position"),
    )
    op.create_table(
        "source_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_url", sa.Text(), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot_url", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.CheckConstraint(
            "origin IN ('source_url', 'secondary_source', 'detected_from', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
        sa.CheckConstraint(
            "provider IN ('wayback', 'archive_today', 'ghostarchive')",
            name="ck_source_archives_provider_valid",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
    )
    op.create_index("ix_source_archives_event_id", "source_archives", ["event_id"])

    # The source each event keeps: the first with a file, else the first, in source order.
    op.execute(
        """
        CREATE TEMPORARY TABLE ranked_sources ON COMMIT DROP AS
        SELECT s.id AS source_id, s.event_id,
               row_number() OVER (
                   PARTITION BY s.event_id
                   ORDER BY (m.id IS NULL),
                            CASE s.level WHEN 'direct' THEN 0 WHEN 'indirect' THEN 1 ELSE 2 END,
                            s.captured_at NULLS LAST, s.created_at, s.id
               ) AS primary_rank,
               row_number() OVER (
                   PARTITION BY s.event_id
                   ORDER BY CASE s.level WHEN 'direct' THEN 0 WHEN 'indirect' THEN 1 ELSE 2 END,
                            s.captured_at NULLS LAST, s.created_at, s.id
               ) AS source_rank
        FROM sources s LEFT JOIN media m ON m.source_id = s.id
        """
    )
    op.execute(
        """
        CREATE TEMPORARY TABLE ranked_links ON COMMIT DROP AS
        SELECT l.*, rs.event_id,
               row_number() OVER (
                   PARTITION BY rs.event_id
                   ORDER BY (rs.primary_rank <> 1), rs.source_rank,
                            l.posted_at NULLS LAST, l.created_at, l.id
               ) AS link_rank
        FROM source_links l JOIN ranked_sources rs ON rs.source_id = l.source_id
        """
    )
    op.execute(
        """
        UPDATE events e SET
            source_url = rl.url,
            source_posted_at = rl.posted_at
        FROM ranked_links rl
        JOIN ranked_sources rs ON rs.source_id = rl.source_id AND rs.primary_rank = 1
        WHERE rl.event_id = e.id AND rl.link_rank = 1
        """
    )
    op.execute(
        """
        UPDATE events e SET capture_source_coords = s.capture_position
        FROM ranked_sources rs JOIN sources s ON s.id = rs.source_id
        WHERE rs.event_id = e.id AND rs.primary_rank = 1
        """
    )
    op.execute(
        """
        UPDATE events e SET is_graphic = true
        WHERE EXISTS (SELECT 1 FROM sources s WHERE s.event_id = e.id AND s.is_graphic)
        """
    )
    op.execute(
        """
        INSERT INTO event_source_links (event_id, position, url)
        SELECT event_id, row_number() OVER (PARTITION BY event_id ORDER BY first_rank) - 1, url
        FROM (
            SELECT rl.event_id, rl.url, min(rl.link_rank) AS first_rank
            FROM ranked_links rl JOIN events e ON e.id = rl.event_id
            WHERE e.source_url IS DISTINCT FROM rl.url
            GROUP BY rl.event_id, rl.url
        ) mirrors
        ORDER BY event_id, first_rank
        """
    )
    op.execute(
        f"DELETE FROM event_source_links WHERE position >= {MAX_SECONDARY_LINKS}"
    )
    op.execute(
        f"""
        INSERT INTO source_archives (id, event_id, original_url, origin, created_at,
                                     snapshot_url, provider)
        SELECT DISTINCT ON (rl.event_id, rl.url)
               gen_random_uuid(), rl.event_id, rl.url,
               CASE WHEN rl.url = e.source_url THEN 'source_url' ELSE 'secondary_source' END,
               rl.archived_at, rl.snapshot_url, {_PROVIDER_CASE.format(col="rl.snapshot_url")}
        FROM ranked_links rl JOIN events e ON e.id = rl.event_id
        WHERE rl.snapshot_url IS NOT NULL
          AND (rl.url = e.source_url
               OR EXISTS (SELECT 1 FROM event_source_links esl
                          WHERE esl.event_id = rl.event_id AND esl.url = rl.url))
        ORDER BY rl.event_id, rl.url, rl.link_rank
        """
    )
    # A requested or geolocated row needs a source URL; one written without a link keeps an
    # empty one.
    op.execute(
        "UPDATE events SET source_url = '' "
        "WHERE source_url IS NULL AND status IN ('requested', 'geolocated')"
    )

    op.add_column("tags", sa.Column("category", sa.String(length=20), nullable=True))
    op.execute("UPDATE tags SET category = 'free'")
    bind = op.get_bind()
    for name in KIND_OF_TAG:
        bind.execute(
            sa.text(
                "INSERT INTO tags (id, name, category, created_at) "
                "VALUES (gen_random_uuid(), :name, 'capture_source', now()) "
                "ON CONFLICT (name) DO UPDATE SET category = 'capture_source'"
            ),
            {"name": name},
        )
    op.alter_column("tags", "category", nullable=False)
    op.create_check_constraint(
        "ck_tags_category_valid", "tags", "category IN ('capture_source', 'free')"
    )
    tag_case = "CASE s.kind " + " ".join(
        f"WHEN '{kind}' THEN '{name}'" for kind, name in TAG_OF_KIND.items()
    ) + " ELSE 'Unknown' END"
    op.execute(
        f"""
        INSERT INTO event_tags (event_id, tag_id)
        SELECT rs.event_id, t.id
        FROM ranked_sources rs
        JOIN sources s ON s.id = rs.source_id
        JOIN tags t ON t.name = {tag_case}
        WHERE rs.primary_rank = 1
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO event_tags (event_id, tag_id)
        SELECT s.event_id, st.tag_id FROM source_tags st JOIN sources s ON s.id = st.source_id
        ON CONFLICT DO NOTHING
        """
    )

    tag_ids = {
        name: str(tag_id)
        for tag_id, name in bind.execute(
            sa.text("SELECT id, name FROM tags WHERE category = 'capture_source'")
        ).all()
    }
    for version_id, snapshot in bind.execute(
        sa.text("SELECT id, snapshot FROM event_versions WHERE snapshot <> '{}'::jsonb")
    ).all():
        bind.execute(
            sa.text("UPDATE event_versions SET snapshot = :snapshot WHERE id = :id"),
            {"snapshot": json.dumps(_legacy_snapshot(snapshot, tag_ids)), "id": version_id},
        )

    op.execute(
        """
        UPDATE media m SET event_id = rs.event_id, role = 'source'
        FROM ranked_sources rs
        WHERE m.source_id = rs.source_id AND rs.primary_rank = 1
        """
    )
    op.execute("DELETE FROM media WHERE event_id IS NULL")
    op.execute("UPDATE media SET role = 'proof' WHERE role IS NULL")
    op.alter_column("media", "role", nullable=False)
    op.create_check_constraint("ck_media_role_valid", "media", "role IN ('source', 'proof')")
    op.create_index(
        "uq_media_source_per_event",
        "media",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("role = 'source'"),
    )
    op.drop_constraint("uq_media_source_id", "media", type_="unique")
    op.drop_constraint("media_source_id_fkey", "media", type_="foreignkey")
    op.drop_column("media", "source_id")
    op.alter_column("media", "event_id", nullable=False)
    op.create_check_constraint(
        "ck_events_source_url_status",
        "events",
        "status NOT IN ('requested', 'geolocated') OR source_url IS NOT NULL",
    )

    op.drop_index("ix_uploads_expires_at", table_name="uploads")
    op.drop_index("ix_uploads_uploader_id", table_name="uploads")
    op.drop_table("uploads")
    op.drop_index("ix_source_tags_tag_id", table_name="source_tags")
    op.drop_table("source_tags")
    op.drop_table("source_links")
    op.drop_index("ix_sources_search_fts", table_name="sources")
    op.drop_index("ix_sources_event_id", table_name="sources")
    op.drop_table("sources")
