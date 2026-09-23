"""分支访谈脚本编辑器 — FastAPI 入口。"""
from __future__ import annotations

import json
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import HOST, PORT, PUBLIC_BASE_URL
from .database import db, init_db
from .schemas import ImportEnvelope, blank_document, normalize_document
from .validation import validate_document

STATIC_DIR = Path(__file__).parent / "static"
EXPORT_VERSION = 1


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="分支访谈脚本编辑器", version="1.0.0", lifespan=lifespan)


# ---------------------------------------------------------------- 工具函数
def _row_to_script(row) -> dict[str, Any]:
    doc = json.loads(row["document"])
    return {
        "id": row["id"],
        "title": row["title"],
        "document": doc,
        "validation": validate_document(doc),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _get_script(conn, script_id: int):
    row = conn.execute(
        "SELECT * FROM scripts WHERE id = ?", (script_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="脚本不存在")
    return row


def _base_url(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


# ---------------------------------------------------------------- 脚本 CRUD
class TitleIn(BaseModel):
    title: str = "未命名访谈"


class DocumentPayload(BaseModel):
    document: dict


class ImportPayload(BaseModel):
    title: str | None = None
    data: dict


@app.get("/api/scripts")
def list_scripts():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM scripts ORDER BY updated_at DESC"
        ).fetchall()
    result = []
    for row in rows:
        item = _row_to_script(row)
        result.append(
            {
                "id": item["id"],
                "title": item["title"],
                "createdAt": item["createdAt"],
                "updatedAt": item["updatedAt"],
                "errorCount": item["validation"]["errorCount"],
                "warningCount": item["validation"]["warningCount"],
            }
        )
    return result


@app.post("/api/scripts", status_code=201)
def create_script(payload: TitleIn | None = None):
    title = (payload.title.strip() if payload and payload.title.strip() else None) or "未命名访谈"
    doc = blank_document()
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO scripts (title, document) VALUES (?, ?)",
            (title, json.dumps(doc, ensure_ascii=False)),
        )
        script_id = cur.lastrowid
        row = _get_script(conn, script_id)
    return _row_to_script(row)


@app.get("/api/scripts/{script_id}")
def get_script(script_id: int):
    with db() as conn:
        row = _get_script(conn, script_id)
    return _row_to_script(row)


@app.put("/api/scripts/{script_id}")
def update_script(script_id: int, payload: DocumentPayload):
    doc, errors = normalize_document(payload.document)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    with db() as conn:
        _get_script(conn, script_id)
        conn.execute(
            "UPDATE scripts SET document = ?, "
            "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
            (json.dumps(doc, ensure_ascii=False), script_id),
        )
        row = _get_script(conn, script_id)
    return _row_to_script(row)


@app.patch("/api/scripts/{script_id}")
def rename_script(script_id: int, payload: TitleIn):
    title = payload.title.strip() or "未命名访谈"
    with db() as conn:
        _get_script(conn, script_id)
        conn.execute(
            "UPDATE scripts SET title = ?, "
            "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
            (title, script_id),
        )
        row = _get_script(conn, script_id)
    return _row_to_script(row)


@app.delete("/api/scripts/{script_id}", status_code=204)
def delete_script(script_id: int):
    with db() as conn:
        _get_script(conn, script_id)
        conn.execute("DELETE FROM scripts WHERE id = ?", (script_id,))


@app.post("/api/scripts/{script_id}/validate")
def validate_script(script_id: int, payload: DocumentPayload):
    doc, errors = normalize_document(payload.document)
    if errors:
        return JSONResponse(
            status_code=422, content={"detail": errors}
        )
    return validate_document(doc)


# ---------------------------------------------------------------- 导入导出
@app.post("/api/scripts/import", status_code=201)
def import_script(payload: ImportPayload):
    raw = payload.data
    # 兼容 {version, title, document} 信封
    if isinstance(raw, dict) and "document" in raw and "nodes" not in raw:
        try:
            envelope = ImportEnvelope.model_validate(raw)
        except Exception:
            raise HTTPException(status_code=422, detail="文件格式不正确")
        raw_doc = envelope.model_dump()["document"]
        title = payload.title or envelope.title
    else:
        raw_doc = raw
        title = payload.title

    doc, errors = normalize_document(raw_doc)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    title = (title or "导入的访谈").strip() or "导入的访谈"

    with db() as conn:
        cur = conn.execute(
            "INSERT INTO scripts (title, document) VALUES (?, ?)",
            (title, json.dumps(doc, ensure_ascii=False)),
        )
        script_id = cur.lastrowid
        row = _get_script(conn, script_id)
    return _row_to_script(row)


@app.get("/api/scripts/{script_id}/export")
def export_script(script_id: int):
    with db() as conn:
        row = _get_script(conn, script_id)
    item = _row_to_script(row)
    return {
        "version": EXPORT_VERSION,
        "kind": "branch-interview-script",
        "title": item["title"],
        "exportedAt": item["updatedAt"],
        "document": item["document"],
    }


# ---------------------------------------------------------------- 只读分享
@app.post("/api/scripts/{script_id}/shares", status_code=201)
def create_share(script_id: int, request: Request):
    token = secrets.token_urlsafe(12)
    with db() as conn:
        _get_script(conn, script_id)
        conn.execute(
            "INSERT INTO shares (token, script_id) VALUES (?, ?)",
            (token, script_id),
        )
    return {"token": token, "url": f"{_base_url(request)}/share/{token}"}


@app.get("/api/scripts/{script_id}/shares")
def list_shares(script_id: int, request: Request):
    with db() as conn:
        _get_script(conn, script_id)
        rows = conn.execute(
            "SELECT token, created_at FROM shares WHERE script_id = ? "
            "ORDER BY created_at DESC",
            (script_id,),
        ).fetchall()
    base = _base_url(request)
    return [
        {"token": r["token"], "url": f"{base}/share/{r['token']}",
         "createdAt": r["created_at"]}
        for r in rows
    ]


@app.delete("/api/shares/{token}", status_code=204)
def revoke_share(token: str):
    with db() as conn:
        cur = conn.execute("DELETE FROM shares WHERE token = ?", (token,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="分享链接不存在")


@app.get("/api/share/{token}")
def get_shared(token: str):
    with db() as conn:
        row = conn.execute(
            "SELECT s.id, s.title, s.document, sh.created_at AS shared_at "
            "FROM shares sh JOIN scripts s ON s.id = sh.script_id "
            "WHERE sh.token = ?",
            (token,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已被撤销")
    doc = json.loads(row["document"])
    return {
        "token": token,
        "title": row["title"],
        "document": doc,
        "validation": validate_document(doc),
        "sharedAt": row["shared_at"],
        "readOnly": True,
    }


# ---------------------------------------------------------------- 运行记录
class RunStep(BaseModel):
    nodeId: str
    optionId: str | None = None
    answer: str | None = None
    title: str | None = None


class RunIn(BaseModel):
    source: str = "preview"
    finished: bool = False
    path: list[RunStep] = []


@app.post("/api/scripts/{script_id}/runs", status_code=201)
def save_run(script_id: int, payload: RunIn):
    with db() as conn:
        _get_script(conn, script_id)
        cur = conn.execute(
            "INSERT INTO runs (script_id, source, finished, path) "
            "VALUES (?, ?, ?, ?)",
            (
                script_id,
                payload.source,
                1 if payload.finished else 0,
                json.dumps(
                    [s.model_dump() for s in payload.path],
                    ensure_ascii=False,
                ),
            ),
        )
        run_id = cur.lastrowid
    return {"id": run_id, "saved": True}


@app.get("/api/scripts/{script_id}/runs")
def list_runs(script_id: int):
    with db() as conn:
        _get_script(conn, script_id)
        rows = conn.execute(
            "SELECT * FROM runs WHERE script_id = ? ORDER BY id DESC LIMIT 100",
            (script_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "source": r["source"],
            "finished": bool(r["finished"]),
            "startedAt": r["started_at"],
            "path": json.loads(r["path"]),
        }
        for r in rows
    ]


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------- 静态页面
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/share/{token}")
def share_page(token: str):
    return FileResponse(STATIC_DIR / "share.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
