FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# ``--proxy-headers --forwarded-allow-ips=*`` makes uvicorn populate
# ``request.url.scheme`` (and ``request.client.host``) from the forwarded
# headers instead of the Railway-edge socket peer. We need this so emails
# generated with absolute URLs see ``https://`` and not ``http://``.
#
# CAVEAT — this populates ``request.client.host`` from the **left-most**
# entry of ``X-Forwarded-For`` (uvicorn's ``always_trust=True`` branch
# returns ``x_forwarded_for_hosts[0]``), which is **attacker-controlled**
# on Railway because Railway *appends* to ``X-Forwarded-For`` rather than
# overwriting it. Anything in this codebase that needs the real client IP
# (rate limits, audit log) MUST NOT read ``request.client.host`` directly.
# It must route through ``services.audit._client_ip``, which
# parses XFF and picks the **right-most** entry, the one the trusted
# proxy actually wrote). That's how ``slowapi.Limiter(key_func=rate_limit_key)``
# closes the spoof vector that would otherwise let an attacker rotate
# ``X-Forwarded-For: <random>`` to mint a fresh rate-limit bucket per
# request or send ``X-Forwarded-For: <victim_ip>`` to lock a victim out.
#
# Without the proxy-headers flags at all, ``request.client.host`` would
# be the Railway-edge proxy IP itself — every request keyed on the same
# bucket, so /login (5/min), /register (10/hr), and /forgot-password (5/hr)
# would all collapse to one shared bucket and a single attacker could lock
# every analyst out of /auth/login. Both
# failure modes are unacceptable; the combination of the flags plus
# the right-most-aware ``rate_limit_key`` is what makes the per-IP
# limits work as intended.
#
# If a second trusted proxy ever sits in front of Railway (Cloudflare,
# etc.), bump ``TRUSTED_PROXY_HOPS`` in env vars to match — see
# ``app/services/audit.py::_client_ip``.
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips=*"]
