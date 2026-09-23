/* 流程图实时校验：与后端 app/validation.py 产出相同结构。 */
'use strict';

const Validator = {
  validate(doc) {
    const nodes = doc.nodes || [];
    const root = doc.root;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const issues = [];
    const isolatedIds = new Set();
    const unreachableIds = new Set();
    const cycleNodeIds = new Set();
    const cycleEdges = [];
    const exitOptionIds = [];
    const danglingOptionIds = [];

    const targetsOf = (node) =>
      (node.options || []).map((o) => [o.id, o.targetId]);

    // 1. 未覆盖出口 & 悬空连线
    const hasIncoming = new Set();
    for (const node of nodes) {
      for (const [optId, target] of targetsOf(node)) {
        if (target == null) {
          const opt = node.options.find((o) => o.id === optId);
          if (!opt.terminal) {
            exitOptionIds.push(optId);
            issues.push({
              severity: 'warning',
              code: 'exposed_exit',
              message: `选项「${opt.label || '未命名'}」没有指向下一节点，也未标记为结束`,
              nodeIds: [node.id],
              optionId: optId,
            });
          }
        } else if (!byId.has(target)) {
          danglingOptionIds.push(optId);
          issues.push({
            severity: 'error',
            code: 'dangling_edge',
            message: `节点「${node.title || node.id}」的选项指向了不存在的节点 ${target}`,
            nodeIds: [node.id],
            optionId: optId,
          });
        } else {
          hasIncoming.add(target);
        }
      }
    }

    // 2. 根节点
    if (nodes.length === 0) {
      issues.push({ severity: 'warning', code: 'no_nodes', message: '脚本还是空的，先添加第一个问题节点' });
    } else if (root == null) {
      issues.push({ severity: 'error', code: 'root_missing', message: '尚未设置起始问题' });
    } else if (!byId.has(root)) {
      issues.push({ severity: 'error', code: 'root_not_found', message: '起始节点不存在，可能已被删除' });
    }

    // 3. BFS 可达
    const reachable = new Set();
    if (byId.has(root)) {
      reachable.add(root);
      const queue = [root];
      for (let head = 0; head < queue.length; head++) {
        const cur = byId.get(queue[head]);
        for (const [, target] of targetsOf(cur)) {
          if (target != null && byId.has(target) && !reachable.has(target)) {
            reachable.add(target);
            queue.push(target);
          }
        }
      }
    }

    for (const node of nodes) {
      const hasOut = targetsOf(node).some(([, t]) => t != null && byId.has(t));
      if (!reachable.has(node.id)) {
        if (!hasIncoming.has(node.id) && !hasOut) {
          isolatedIds.add(node.id);
          issues.push({
            severity: 'error',
            code: 'isolated',
            message: `节点「${node.title || node.id}」是孤立的（没有任何连线）`,
            nodeIds: [node.id],
          });
        } else {
          unreachableIds.add(node.id);
          issues.push({
            severity: 'warning',
            code: 'unreachable',
            message: `节点「${node.title || node.id}」从起点无法到达`,
            nodeIds: [node.id],
          });
        }
      }
    }

    // 4. Tarjan SCC
    let indexCounter = 0;
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowlink = new Map();

    function strongConnect(v) {
      indices.set(v, indexCounter);
      lowlink.set(v, indexCounter);
      indexCounter++;
      stack.push(v);
      onStack.add(v);
      for (const [, target] of targetsOf(byId.get(v))) {
        if (target == null || !byId.has(target)) continue;
        if (!indices.has(target)) {
          strongConnect(target);
          lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(target)));
        } else if (onStack.has(target)) {
          lowlink.set(v, Math.min(lowlink.get(v), indices.get(target)));
        }
      }
      if (lowlink.get(v) === indices.get(v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        const selfLoop = targetsOf(byId.get(v)).some(([, t]) => t === v);
        if (comp.length > 1 || selfLoop) comp.forEach((id) => cycleNodeIds.add(id));
      }
    }
    for (const node of nodes) if (!indices.has(node.id)) strongConnect(node.id);

    if (cycleNodeIds.size > 0) {
      issues.push({
        severity: 'error',
        code: 'cycle',
        message: `检测到 ${cycleNodeIds.size} 个节点参与了环路，访谈将无法结束`,
        nodeIds: [...cycleNodeIds],
      });
    }

    // 5. DFS 回边（用于红色虚线标注）
    const color = new Map(nodes.map((n) => [n.id, 0]));
    function dfs(v) {
      color.set(v, 1);
      for (const [optId, target] of targetsOf(byId.get(v))) {
        if (target == null || !byId.has(target)) continue;
        if (color.get(target) === 0) dfs(target);
        else if (color.get(target) === 1) cycleEdges.push([v, optId]);
      }
      color.set(v, 2);
    }
    for (const node of nodes) if (color.get(node.id) === 0) dfs(node.id);

    return {
      ok: issues.every((i) => i.severity !== 'error'),
      errorCount: issues.filter((i) => i.severity === 'error').length,
      warningCount: issues.filter((i) => i.severity === 'warning').length,
      issues,
      cycleNodeIds: [...cycleNodeIds],
      cycleEdges,
      isolatedNodeIds: [...isolatedIds],
      unreachableNodeIds: [...unreachableIds],
      exitOptionIds,
      danglingOptionIds,
    };
  },
};
