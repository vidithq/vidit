from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
    # Error text leaves out bound parameters (password hashes, emails), so
    # they never reach logs or Sentry.
    hide_parameters=True,
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass
