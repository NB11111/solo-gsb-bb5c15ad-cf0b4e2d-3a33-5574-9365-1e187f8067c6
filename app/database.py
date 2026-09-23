"""SQLite 连接管理。"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .config import DATABASE_PATH


def get_connection() -> sqlite3.Connection:
    Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS scripts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL DEFAULT '未命名访谈',
                document    TEXT NOT NULL DEFAULT '{"root": null, "nodes": []}',
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS shares (
                token       TEXT PRIMARY KEY,
                script_id   INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE TABLE IF NOT EXISTS runs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                script_id   INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
                source      TEXT NOT NULL DEFAULT 'preview',
                started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                finished    INTEGER NOT NULL DEFAULT 0,
                path        TEXT NOT NULL DEFAULT '[]'
            );
            """
        )
