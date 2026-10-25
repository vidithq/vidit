# Vidit - Makefile for local development

.PHONY: help install env db-up db-down migrate dev-backend dev-frontend dev-worker dev test clean init seed seed-detections typology-weights mock-admin gen-api-types check-dup vulture check-changelog hygiene

help:
	@echo "Available commands:"
	@echo "  make init          - Full initialization (install + env + db-up + migrate)"
	@echo "  make install       - Install backend (uv) and frontend (npm) dependencies"
	@echo "  make env           - Initialize .env files from templates (.env and .env.local)"
	@echo "  make db-up         - Start the PostgreSQL + PostGIS container"
	@echo "  make db-down       - Stop the database container"
	@echo "  make migrate       - Apply database migrations via Alembic"
	@echo "  make seed          - mock-admin + machine detections from the synthetic archive"
	@echo "  make seed-detections - Backfill machine 'detected' geolocations from the synthetic archive"
	@echo "  make typology-weights - Recompute weights.json + golden fixtures from the local corpus (gitignored)"
	@echo "  make mock-admin    - Create a mock admin user (admin@vidit.app / admin)"
	@echo "  make dev-backend   - Run FastAPI dev server (port 8000)"
	@echo "  make dev-frontend  - Run Next.js dev server (port 3000)"
	@echo "  make dev-worker    - Run the background worker (email queues, archive imports, bot webhooks)"
	@echo "  make dev           - Run both backend and frontend in parallel"
	@echo "  make test          - Run backend test suite (pytest)"
	@echo "  make gen-api-types - Regenerate frontend API types from the backend OpenAPI spec"
	@echo "  make hygiene       - Duplication (jscpd) + dead-code (knip frontend, vulture backend) + changelog line-length checks"
	@echo "  make clean         - Stop containers and purge local storage/cache/builds"

init: install env db-up migrate
	@echo "Initialization complete. Run 'make dev' to start."

seed-detections:
	cd backend && uv run python scripts/seed_detections.py

# Typology QA harness: distils the local corpus under backend/datasets/
# (gitignored, rebuilt by the tooling that lives there) into the committed
# weights.json + fixtures.json.
typology-weights:
	cd backend && uv run python -m tests.typology.weights && uv run python -m tests.typology.gen_fixtures

mock-admin:
	cd backend && uv run python scripts/mock_admin.py

seed: mock-admin seed-detections
	@echo "Done. admin@vidit.app exists and the synthetic archive's detections are in."

install:
	cd backend && uv sync --all-extras
	cd frontend && npm install

env:
	@if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env && echo "Created backend/.env"; fi
	@if [ ! -f frontend/.env.local ]; then cp frontend/.env.local.example frontend/.env.local && echo "Created frontend/.env.local"; fi

db-up:
	docker-compose up -d
	@echo "Waiting for database to be ready..."
	@sleep 3

db-down:
	docker-compose down

migrate:
	cd backend && uv run alembic upgrade head

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev-worker:
	cd backend && uv run python scripts/run_import_worker.py

dev:
	@echo "Starting development servers... (Backend :8000, Frontend :3000)"
	(make dev-backend) & (make dev-frontend) & wait

test:
	cd backend && uv run pytest -n auto --dist worksteal

# Generate the frontend's API types from the backend OpenAPI spec. The dumped
# spec (frontend/openapi.json) is a gitignored intermediate; the generated
# src/lib/api-types.ts IS committed. CI re-runs this and `git diff --exit-code`s
# the result, so a backend schema change that wasn't regenerated fails the build.
gen-api-types:
	cd backend && uv run --no-sync python scripts/dump_openapi.py ../frontend/openapi.json
	cd frontend && npx openapi-typescript openapi.json -o src/lib/api-types.ts

check-dup:
	npx --yes jscpd@4.2.5 backend/app frontend/src

# Backend dead-code gate (the analogue of the frontend's knip).
vulture:
	cd backend && uv run vulture

# CHANGELOG entries stay one short line each (CONTRIBUTING.md).
check-changelog:
	awk 'length($$0) > 300 { print "::error file=CHANGELOG.md,line=" NR "::Line is " length($$0) " characters; keep a CHANGELOG entry to one line of at most 300"; bad=1 } END { exit bad }' CHANGELOG.md

hygiene: check-dup vulture check-changelog
	cd frontend && npm run knip
	cd frontend && npm run palette:check

clean:
	docker-compose down -v
	rm -rf backend/.local-storage
	rm -rf backend/.pytest_cache
	rm -rf frontend/.next
	rm -rf frontend/node_modules
	rm -rf backend/.venv
