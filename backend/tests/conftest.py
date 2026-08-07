import os

# Must be set before `app.core.config` (and anything importing it) loads, so
# the app's global engine never points at the real ./app.db during tests.
# conftest.py is always imported before test modules are collected, which
# guarantees that ordering regardless of file collection order.
os.environ.setdefault("DATABASE_URL", "sqlite://")
