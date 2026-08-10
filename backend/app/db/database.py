from typing import Generator

from sqlmodel import Session, SQLModel, create_engine, text

from app.core.config import settings

connect_args = (
    {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
)
engine = create_engine(settings.DATABASE_URL, echo=False, connect_args=connect_args)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    _run_lightweight_migrations()


def _run_lightweight_migrations() -> None:
    """There's no migration framework (Alembic) set up for this small
    single-user app — `create_all` only creates missing *tables*, so a new
    column added to the model of an existing table needs a manual add-if-
    missing check here instead. Cheap and idempotent enough to run on every
    startup; add another block here the next time a column is added.
    """
    with engine.connect() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(shiftsettings)"))}
        if columns and "buffer_minutes" not in columns:
            conn.execute(text("ALTER TABLE shiftsettings ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 10"))
            conn.commit()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
