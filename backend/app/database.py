from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# How long a statement waits for a lock another transaction holds before
# Postgres cancels it. Set on every connection, so no wait is unbounded.
LOCK_TIMEOUT_MS = 5000

engine = create_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"options": f"-c lock_timeout={LOCK_TIMEOUT_MS}"},
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass
