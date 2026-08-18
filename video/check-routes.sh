#!/usr/bin/env bash
#
# Route gate for the capture scripts.
#
# The capture scripts drive the real API and the real frontend, so a route
# rename anywhere else in the repo breaks them silently: every call 404s,
# and nobody finds out until the next promo render. Nothing else covers
# them (they run outside the test suites and outside the jscpd scan), so
# this grep is the guard.
#
# It bans the spellings that have already gone stale once: the `/geolocations`
# API namespace (the backend mounts `/events`), `requests` as a top-level API
# resource (a request is a `requested` event, so it is `POST /events/requests`
# and `GET /events?view=requested`), the two frontend routes that are now
# redirect stubs (`/geolocations/new` and `/requests/new`, both `/submit`), and
# the removed tweet-media proxy (`GET /events/import-from-tweet/media`: the
# paste creates detections now, so media comes off the detection's `storage_url`).
#
# Comments are stripped before the scan, so prose may name an old route while
# code may not.
#
#   ./video/check-routes.sh      # or: make hygiene

set -euo pipefail

cd "$(dirname "$0")"

# pattern<TAB>what to use instead
BANNED=$(
  cat <<'EOF'
\$\{API\}/geolocations	${API}/events
/api/v1/geolocations	/api/v1/events
admin/geolocations	admin/events
\\/geolocations\\/	\\/events\\/
"/geolocations	"/submit (the /geolocations routes are redirect stubs)
\$\{API\}/requests	${API}/events/requests or ${API}/events?view=requested
/requests/new	/submit
/requests/\$\{	/events/${...} for the API; /requests/${...} stays valid only as a frontend link
import-from-tweet/media	GET /events/{id} plus the storage_url on its media (the proxy is removed)
EOF
)

status=0
for script in ./*.js; do
  # Strip `//` line comments so prose about the rename does not trip the gate.
  code=$(sed 's://.*::' "$script")
  while IFS=$'\t' read -r pattern replacement; do
    [ -z "$pattern" ] && continue
    if hits=$(printf '%s\n' "$code" | grep -nE "$pattern"); then
      status=1
      echo "✗ $script: stale route \"$pattern\" — use $replacement"
      printf '%s\n' "$hits" | sed 's/^/    /'
    fi
  done <<<"$BANNED"
done

if [ "$status" -ne 0 ]; then
  echo
  echo "The capture scripts call routes that no longer exist. See docs/api.md"
  echo "for the current spellings, and video/README.md for how to re-run them."
  exit 1
fi

echo "✓ video capture scripts call only current routes"
