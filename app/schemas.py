"""请求/响应模型与文档规范化。"""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class OptionIn(BaseModel):
    id: str
    label: str = ""
    terminal: bool = False
    targetId: str | None = None


class NodeIn(BaseModel):
    id: str
    type: Literal["question"] = "question"
    title: str = ""
    x: float = 0
    y: float = 0
    options: list[OptionIn] = Field(default_factory=list)


class DocumentIn(BaseModel):
    root: str | None = None
    nodes: list[NodeIn] = Field(default_factory=list)


class ImportEnvelope(BaseModel):
    """导入时既接受完整信封 {version, document}，也接受裸 document。"""

    version: int | None = None
    title: str | None = None
    document: DocumentIn


def normalize_document(raw: dict) -> tuple[dict, list[str]]:
    """规范化导入/保存的文档，自动补全缺失 id。

    返回 (document, errors)；errors 非空时调用方应返回 422。
    """
    errors: list[str] = []
    doc = DocumentIn.model_validate(raw).model_dump()

    seen_node_ids: set[str] = set()
    for node in doc["nodes"]:
        if not node["id"] or node["id"] in seen_node_ids:
            errors.append(f"节点 id 重复或为空: {node.get('id')}")
        seen_node_ids.add(node["id"])
        node["x"] = float(node["x"])
        node["y"] = float(node["y"])
        seen_opt: set[str] = set()
        for opt in node["options"]:
            if not opt["id"] or opt["id"] in seen_opt:
                errors.append(
                    f"节点 {node['id']} 下选项 id 重复或为空: {opt.get('id')}"
                )
            seen_opt.add(opt["id"])
            # 结束分支不应再携带目标
            if opt["terminal"]:
                opt["targetId"] = None

    if doc["root"] is not None and doc["root"] not in seen_node_ids:
        errors.append(f"起始节点不存在: {doc['root']}")

    for node in doc["nodes"]:
        for opt in node["options"]:
            if opt["targetId"] is not None and opt["targetId"] not in seen_node_ids:
                errors.append(
                    f"节点 {node['id']} 的选项 {opt['id']} "
                    f"指向了不存在的节点 {opt['targetId']}"
                )

    return doc, errors


def blank_document() -> dict:
    """新建脚本时自带一个起始问题。"""
    node = {
        "id": new_id("n"),
        "type": "question",
        "title": "第一个问题",
        "x": 80,
        "y": 120,
        "options": [
            {"id": new_id("o"), "label": "是", "terminal": False, "targetId": None}
        ],
    }
    return {"root": node["id"], "nodes": [node]}
