"""访谈流程图校验：环路 / 孤立与不可达节点 / 未覆盖出口 / 悬空连线。

前端 js/validator.js 镜像了同一套算法，两边产出相同的 issue 结构。
"""
from __future__ import annotations

import sys
from typing import Any

sys.setrecursionlimit(10000)


def _option_targets(node: dict) -> list[tuple[str, str | None]]:
    """返回 [(optionId, targetId), ...]。"""
    return [(o["id"], o.get("targetId")) for o in node.get("options", [])]


def validate_document(doc: dict) -> dict[str, Any]:
    nodes: list[dict] = doc.get("nodes") or []
    root = doc.get("root")
    by_id: dict[str, dict] = {n["id"]: n for n in nodes}

    issues: list[dict] = []
    isolated_ids: set[str] = set()
    unreachable_ids: set[str] = set()
    cycle_node_ids: set[str] = set()
    cycle_edges: list[list[str]] = []
    exit_option_ids: list[str] = []
    dangling_option_ids: list[str] = []

    # ---- 1. 出口与悬空连线，同时构建出入度 ----
    has_incoming: set[str] = set()
    for node in nodes:
        for opt_id, target in _option_targets(node):
            if target is None:
                option = next(o for o in node["options"] if o["id"] == opt_id)
                if not option.get("terminal"):
                    exit_option_ids.append(opt_id)
                    issues.append(
                        {
                            "severity": "warning",
                            "code": "exposed_exit",
                            "message": f"选项「{option.get('label') or '未命名'}」"
                            f"没有指向下一节点，也未标记为结束",
                            "nodeIds": [node["id"]],
                            "optionId": opt_id,
                        }
                    )
            elif target not in by_id:
                dangling_option_ids.append(opt_id)
                issues.append(
                    {
                        "severity": "error",
                        "code": "dangling_edge",
                        "message": f"节点「{node.get('title') or node['id']}」的"
                        f"选项指向了不存在的节点 {target}",
                        "nodeIds": [node["id"]],
                        "optionId": opt_id,
                    }
                )
            else:
                has_incoming.add(target)

    # ---- 2. 根节点检查 ----
    if not nodes:
        issues.append(
            {
                "severity": "warning",
                "code": "no_nodes",
                "message": "脚本还是空的，先添加第一个问题节点",
            }
        )
    elif root is None:
        issues.append(
            {
                "severity": "error",
                "code": "root_missing",
                "message": "尚未设置起始问题",
            }
        )
    elif root not in by_id:
        issues.append(
            {
                "severity": "error",
                "code": "root_not_found",
                "message": "起始节点不存在，可能已被删除",
            }
        )

    # ---- 3. 从根节点 BFS，求可达集合 ----
    reachable: set[str] = set()
    if root in by_id:
        reachable.add(root)
        queue = [root]
        head = 0
        while head < len(queue):
            cur = by_id[queue[head]]
            head += 1
            for _, target in _option_targets(cur):
                if target in by_id and target not in reachable:
                    reachable.add(target)
                    queue.append(target)

    for node in nodes:
        nid = node["id"]
        has_out = any(
            t is not None and t in by_id for _, t in _option_targets(node)
        )
        if nid not in reachable:
            if not has_incoming and not has_out:
                isolated_ids.add(nid)
                issues.append(
                    {
                        "severity": "error",
                        "code": "isolated",
                        "message": f"节点「{node.get('title') or nid}」是孤立的"
                        f"（没有任何连线）",
                        "nodeIds": [nid],
                    }
                )
            else:
                unreachable_ids.add(nid)
                issues.append(
                    {
                        "severity": "warning",
                        "code": "unreachable",
                        "message": f"节点「{node.get('title') or nid}」从起点无法到达",
                        "nodeIds": [nid],
                    }
                )

    # ---- 4. 环路：Tarjan SCC + DFS 回边 ----
    index_counter = [0]
    stack: list[str] = []
    on_stack: set[str] = set()
    indices: dict[str, int] = {}
    lowlink: dict[str, int] = {}

    def strong_connect(v: str) -> None:
        indices[v] = index_counter[0]
        lowlink[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for _, target in _option_targets(by_id[v]):
            if target not in by_id:
                continue
            if target not in indices:
                strong_connect(target)
                lowlink[v] = min(lowlink[v], lowlink[target])
            elif target in on_stack:
                lowlink[v] = min(lowlink[v], indices[target])
        if lowlink[v] == indices[v]:
            component: list[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                component.append(w)
                if w == v:
                    break
            is_self_loop = any(
                t == v for _, t in _option_targets(by_id[v])
            )
            if len(component) > 1 or is_self_loop:
                cycle_node_ids.update(component)

    for n in nodes:
        if n["id"] not in indices:
            strong_connect(n["id"])

    if cycle_node_ids:
        issues.append(
            {
                "severity": "error",
                "code": "cycle",
                "message": f"检测到 {len(cycle_node_ids)} 个节点参与了环路，"
                f"访谈将无法结束",
                "nodeIds": sorted(cycle_node_ids),
            }
        )

    # DFS 回边（灰色后代）=> 画红的回边
    color: dict[str, int] = {n["id"]: 0 for n in nodes}

    def dfs(v: str) -> None:
        color[v] = 1
        for opt_id, target in _option_targets(by_id[v]):
            if target not in by_id:
                continue
            if color[target] == 0:
                dfs(target)
            elif color[target] == 1:
                cycle_edges.append([v, opt_id])
        color[v] = 2

    for n in nodes:
        if color[n["id"]] == 0:
            dfs(n["id"])

    errors = sum(1 for i in issues if i["severity"] == "error")
    warnings = sum(1 for i in issues if i["severity"] == "warning")
    return {
        "ok": errors == 0,
        "errorCount": errors,
        "warningCount": warnings,
        "issues": issues,
        "cycleNodeIds": sorted(cycle_node_ids),
        "cycleEdges": cycle_edges,
        "isolatedNodeIds": sorted(isolated_ids),
        "unreachableNodeIds": sorted(unreachable_ids),
        "exitOptionIds": exit_option_ids,
        "danglingOptionIds": dangling_option_ids,
    }
