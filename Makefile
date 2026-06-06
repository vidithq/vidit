# Vidit - Makefile for local development

.PHONY: help install env db-up db-build db-down migrate dev-backend dev-frontend dev test clean init seed seed-demo seed-timeline mock-admin mock-demo-user promo

help:
	@echo "Available commands:"
	@echo "  make init          - Full initialization (install + env + db-up + migrate)"
	@echo "  make install       - Install backend (uv) and frontend (npm) dependencies"
	@echo "  make env           - Initialize .env files from templates (.env and .env.local)"
	@echo "  make db-up         - Start custom PostgreSQL 18.3 container (PostGIS, pgvector, AGE, cron)"
	@echo "  make db-build      - Force rebuild the custom database image"
	@echo "  make db-down       - Stop the database container"
	@echo "  make migrate       - Apply database migrations via Alembic"
	@echo "  make seed          - mock-admin + 50 demo geolocations + admin follows every demo analyst"
	@echo "  make seed-demo     - Just the 50 demo geolocations (no admin, no follows)"
	@echo "  make seed-timeline - Make the admin user follow every demo analyst"
	@echo "  make mock-admin    - Create a mock admin user (admin@vidit.app / admin)"
	@echo "  make dev-backend   - Run FastAPI dev server (port 8000)"
	@echo "  make dev-frontend  - Run Next.js dev server (port 3000)"
	@echo "  make dev           - Run both backend and frontend in parallel"
	@echo "  make test          - Run backend test suite (pytest)"
	@echo "  make clean         - Stop containers and purge local storage/cache/builds"
	@echo "  make promo         - Regenerate the closed-beta promo MP4 (see video/README.md)"

init: install env db-up migrate
	@echo "Initialization complete. Run 'make dev' to start."

seed-demo:
	cd backend && uv run python scripts/seed_demo.py

seed-timeline:
	cd backend && uv run python scripts/seed_timeline.py

mock-admin:
	cd backend && uv run python scripts/mock_admin.py

mock-demo-user:
	cd backend && uv run python scripts/mock_demo_user.py

# End-to-end promo render. Requires `make dev` running in another shell.
# Also assumes `make seed` has been executed at least once for curated tags
# + the demo geolocations that make the map look populated — the deps
# below only cover the user accounts the pipeline mints itself.
# See video/README.md for the breakdown of each step.
promo: mock-admin mock-demo-user
	cd video && node seed-bounties.js
	cd video && node record-submit.js
	cp video/out/recording-submit.mp4 video/public/recording-submit.mp4
	cd video && npx remotion render src/index.ts Demo out/promo-final.mp4 --codec h264 --crf 16
	@echo "Done. Promo at video/out/promo-final.mp4"

seed: mock-admin seed-demo seed-timeline
	@echo "Done. admin@vidit.app exists, 50 demo geolocations seeded, admin follows every demo analyst."

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

dev:
	@echo "Starting development servers... (Backend :8000, Frontend :3000)"
	(make dev-backend) & (make dev-frontend) & wait

test:
	cd backend && uv run pytest

clean:
	docker-compose down -v
	rm -rf backend/.local-storage
	rm -rf backend/.pytest_cache
	rm -rf frontend/.next
	rm -rf frontend/node_modules
	rm -rf backend/.venv
