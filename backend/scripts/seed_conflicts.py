"""One-shot historical seed of the conflicts referential from Wikidata.

Pulls every armed conflict started in or after ``SINCE_YEAR`` (types in
``TYPE_ALLOWLIST``: wars, civil wars, rebellions, insurgencies, world wars,
plus a few relevant margins; battles / military operations / coup attempts
are deliberately excluded as sub-conflict noise) and inserts the missing
ones as ``source='seed'``, ``ongoing=false`` rows. The Wikipedia sync
(``scripts/sync_conflicts.py``) is what flips the ongoing subset to true
and keeps it current; this seed only provides the historical depth so
analysts can tag archival footage.

Idempotent and non-destructive: rows are matched by ``wikidata_id`` and
existing rows are never modified (the sync owns them). A label colliding
with an existing name gets the start year appended; a still-colliding one
is skipped and reported.

    uv run python scripts/seed_conflicts.py --dry-run   # print, write nothing
    uv run python scripts/seed_conflicts.py
"""

import sys
import uuid
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models.conflict import Conflict

SPARQL_URL = "https://query.wikidata.org/sparql"
_HTTP_TIMEOUT_S = 120.0
_USER_AGENT = "vidit-conflict-seed/1.0 (https://vidit.app)"

SINCE_YEAR = 1914

# ``conflicts.name`` is VARCHAR(200); labels are truncated to fit before any
# write so an over-long Wikidata label can't raise a raw DataError.
_NAME_MAX_LENGTH = 200

# Wikidata P31 classes accepted as product-level conflicts. Measured on the
# post-1914 population: this allowlist keeps ~700-850 items and drops the
# dominant noise classes (attempted coups, border incidents, protests,
# mutinies, war phases / theaters).
TYPE_ALLOWLIST = {
    "Q198": "war",
    "Q8465": "civil war",
    "Q350604": "armed conflict",
    "Q124734": "rebellion",
    "Q3119647": "insurgency",
    "Q103495": "world war",
    "Q864113": "proxy war",
    "Q1006311": "war of national liberation",
    "Q766875": "ethnic conflict",
    "Q2334719": "border conflict",
}

_QUERY_TEMPLATE = """
SELECT ?item ?label ?start ?end WHERE {{
  VALUES ?type {{ {types} }}
  ?item wdt:P31 ?type .
  ?item wdt:P580 ?start .
  FILTER(YEAR(?start) >= {since})
  OPTIONAL {{ ?item wdt:P582 ?end }}
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
}}
"""


def fetch_rows(client: httpx.Client | None = None) -> list[dict]:
    """Query Wikidata and fold the bindings into one row per QID."""
    query = _QUERY_TEMPLATE.format(
        types=" ".join(f"wd:{qid}" for qid in TYPE_ALLOWLIST),
        since=SINCE_YEAR,
    )

    def year(value: str | None) -> int | None:
        # A Wikidata "unknown value" comes back as a blank-node URI, not a
        # date; treat anything that doesn't start with a 4-digit year as
        # absent rather than crashing the seed.
        if value is None or not value[:4].isdigit():
            return None
        return int(value[:4])

    def run(c: httpx.Client) -> list[dict]:
        resp = c.get(SPARQL_URL, params={"query": query, "format": "json"})
        resp.raise_for_status()
        bindings = resp.json()["results"]["bindings"]
        by_qid: dict[str, dict] = {}
        for b in bindings:
            qid = b["item"]["value"].rsplit("/", 1)[1]
            start_year = year(b["start"]["value"])
            if start_year is None:
                continue
            row = {
                "wikidata_id": qid,
                "name": b["label"]["value"].strip(),
                "start_year": start_year,
                "end_year": year(b.get("end", {}).get("value")),
            }
            # An item can carry several dates/types; keep the earliest start
            # and the latest end so duplicate bindings collapse stably.
            prev = by_qid.get(qid)
            if prev is not None:
                row["start_year"] = min(row["start_year"], prev["start_year"])
                if row["end_year"] is not None and prev["end_year"] is not None:
                    row["end_year"] = max(row["end_year"], prev["end_year"])
                elif prev["end_year"] is None:
                    row["end_year"] = None
                row["name"] = prev["name"]
            by_qid[qid] = row
        return sorted(by_qid.values(), key=lambda r: (r["start_year"], r["name"]))

    if client is None:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S, headers={"User-Agent": _USER_AGENT}) as own:
            return run(own)
    return run(client)


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    rows = fetch_rows()
    print(f"Wikidata returned {len(rows)} conflicts since {SINCE_YEAR}.")

    db = SessionLocal()
    try:
        existing_qids = {
            q for (q,) in db.query(Conflict.wikidata_id).filter(Conflict.wikidata_id.isnot(None))
        }
        taken_names = {n for (n,) in db.query(Conflict.name)}

        to_insert: list[dict] = []
        skipped: list[str] = []
        for row in rows:
            if row["wikidata_id"] in existing_qids:
                continue
            name = row["name"][:_NAME_MAX_LENGTH]
            if name in taken_names:
                suffix = f" ({row['start_year']})"
                name = f"{name[: _NAME_MAX_LENGTH - len(suffix)]}{suffix}"
            if name in taken_names:
                skipped.append(f"{row['wikidata_id']} {row['name']!r}: name collision")
                continue
            taken_names.add(name)
            # ``conflicts.id`` has no server default (the ORM supplies
            # ``uuid.uuid4``), so the Core insert must pass it explicitly.
            to_insert.append(
                {**row, "id": uuid.uuid4(), "name": name, "ongoing": False, "source": "seed"}
            )

        if dry_run:
            for row in to_insert:
                end = row["end_year"] or "ongoing"
                print(f"  + {row['wikidata_id']:<12} {row['start_year']}-{end}  {row['name']}")
        elif to_insert:
            db.execute(
                pg_insert(Conflict)
                .values(to_insert)
                .on_conflict_do_nothing(index_elements=["wikidata_id"])
            )
            db.commit()

        verb = "Would insert" if dry_run else "Inserted"
        print(f"{verb} {len(to_insert)} rows ({len(existing_qids)} QIDs already present).")
        for reason in skipped:
            print(f"  skipped: {reason}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
