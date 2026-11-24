import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text

import app.models  # noqa: F401
from alembic import context
from app.config import settings
from app.database import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Tables an extension owns: PostGIS spatial_ref_sys, and the postgis_topology and
# postgis_tiger_geocoder tables a database search_path can expose. No model declares them.
_EXTENSION_TABLES = text(
    "SELECT c.relname FROM pg_depend d JOIN pg_class c ON c.oid = d.objid"
    " WHERE d.deptype = 'e' AND d.classid = 'pg_class'::regclass AND c.relkind = 'r'"
)
extension_tables: set[str] = set()


def include_object(object, name, type_, reflected, compare_to):
    return not (type_ == "table" and reflected and name in extension_tables)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    # Its own connection: a read on the migration connection opens the transaction that
    # begin_transaction() would then leave uncommitted.
    with connectable.connect() as connection:
        extension_tables.update(connection.execute(_EXTENSION_TABLES).scalars())
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
