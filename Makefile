# Vidit - Makefile for local development

.PHONY: help install env db-up db-build db-down migrate dev-backend dev-frontend dev-worker dev test clean init seed seed-detections typology-weights mock-admin import-prod promo gen-api-types check-dup vulture check-video-routes hygiene

help:
	@echo "Available commands:"
	@echo "  make init          - Full initialization (install + env + db-up + migrate)"
	@echo "  make install       - Install backend (uv) and frontend (npm) dependencies"
	@echo "  make env           - Initialize .env files from templates (.env and .env.local)"
	@echo "  make db-up         - Start custom PostgreSQL 18.3 container (PostGIS, pgvector, AGE, cron)"
	@echo "  make db-build      - Force rebuild the custom database image"
	@echo "  make db-down       - Stop the database container"
	@echo "  make migrate       - Apply database migrations via Alembic"
	@echo "  make seed          - mock-admin + machine detections from the synthetic archive"
	@echo "  make seed-detections - Backfill machine 'detected' geolocations from the synthetic archive"
	@echo "  make import-prod   - Restore the latest production backup into the local dev database"
	@echo "  make typology-weights - Recompute weights.json + golden fixtures from the local corpus (gitignored)"
	@echo "  make mock-admin    - Create a mock admin user (admin@vidit.app / admin)"
	@echo "  make dev-backend   - Run FastAPI dev server (port 8000)"
	@echo "  make dev-frontend  - Run Next.js dev server (port 3000)"
	@echo "  make dev-worker    - Run the archive-import worker (drains upload jobs)"
	@echo "  make dev           - Run both backend and frontend in parallel"
	@echo "  make test          - Run backend test suite (pytest)"
	@echo "  make gen-api-types - Regenerate frontend API types from the backend OpenAPI spec"
	@echo "  make hygiene       - Duplication (jscpd) + dead-code (knip frontend, vulture backend) + video-route checks"
	@echo "  make clean         - Stop containers and purge local storage/cache/builds"
	@echo "  make promo         - Regenerate the promo MP4 (see video/README.md)"

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

# Replace the local dev database with the most recent production backup. Reads
# the daily dump the backup cron writes to S3; see docs/backups.md. Needs
# BACKUP_S3_BUCKET and AWS_PROFILE in the environment. Pass ARGS=--yes to skip
# the confirmation.
import-prod:
	./backend/scripts/import_prod.sh $(ARGS)

# End-to-end promo render. Requires `make dev` running in another shell.
# Also assumes the local database already carries a populated catalog, so
# the map reads as populated on camera: `make import-prod` or an archive
# import covers that.
#
# Two outputs stage off one capture run:
#   - `promo-master.mp4` — 2560×1440 / 60fps comp / CRF 16, +faststart
#                          (S3 → landing's `<video>`; also the archive)
#   - `promo-readme.mp4` — 1280×720  / 30fps      / CRF 26, +faststart
#                          (drag-drop into a GitHub draft for the
#                           user-attachments URL the README embeds)
#
# Master is rendered at Remotion `--scale 2` (4K canvas) so the
# rasterised captions / brand chrome are crisp, then ffmpeg downscales
# to 2K. A 1080p intermediate isn't worth maintaining at beta
# traffic: the master streams fine over CloudFront and the browser
# downscales for free.
# See video/README.md for the breakdown of each step.
promo: mock-admin
	cd video && node seed-requests.js
	cd video && node record-submit.js
	cp video/out/recording-submit.mp4 video/public/recording-submit.mp4
	cd video && npx remotion render src/index.ts Demo out/promo-4k.mp4 --codec h264 --crf 16 --scale 2
	ffmpeg -y -i video/out/promo-4k.mp4 -vf scale=2560:-2 -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart video/out/promo-master.mp4
	ffmpeg -y -i video/out/promo-4k.mp4 -vf scale=1280:-2,fps=30 -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart video/out/promo-readme.mp4
	@ls -lh video/out/promo-master.mp4 video/out/promo-readme.mp4
	@echo "Done. Master 2K (S3) → video/out/promo-master.mp4 | README 720p → video/out/promo-readme.mp4"

seed: mock-admin seed-detections
	@echo "Done. admin@vidit.app exists and the synthetic archive's detections are in."

install:
	cd backend && uv sync
	cd frontend && npm install

env:
	@if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env && echo "Created backend/.env"; fi
	@if [ ! -f frontend/.env.local ]; then cp frontend/.env.local.example frontend/.env.local && echo "Created frontend/.env.local"; fi

db-up:
	docker-compose up -d
	@echo "Waiting for database to be ready..."
	@sleep 3

db-build:
	docker-compose build db

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
	cd backend && uv run pytest -n auto --dist loadfile

# Generate the frontend's API types from the backend OpenAPI spec. The dumped
# spec (frontend/openapi.json) is a gitignored intermediate; the generated
# src/lib/api-types.ts IS committed. CI re-runs this and `git diff --exit-code`s
# the result, so a backend schema change that wasn't regenerated fails the build.
gen-api-types:
	cd backend && uv run --no-sync python scripts/dump_openapi.py > ../frontend/openapi.json
	cd frontend && npx openapi-typescript openapi.json -o src/lib/api-types.ts

check-dup:
	npx --yes jscpd@4.2.5 backend/app frontend/src

# Backend dead-code gate (the analogue of the frontend's knip).
vulture:
	cd backend && uv run vulture

# The capture scripts run outside every test suite, so a route rename
# elsewhere in the repo only surfaces at the next promo render. See
# video/check-routes.sh.
check-video-routes:
	./video/check-routes.sh

hygiene: check-dup vulture check-video-routes
	cd frontend && npm run knip
	cd frontend && npm run palette:check

clean:
	docker-compose down -v
	rm -rf backend/.local-storage
	rm -rf backend/.pytest_cache
	rm -rf frontend/.next
	rm -rf frontend/node_modules
	rm -rf backend/.venv
