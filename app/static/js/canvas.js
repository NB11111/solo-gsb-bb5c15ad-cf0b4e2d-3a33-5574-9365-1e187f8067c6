/* 画布：节点渲染、拖动、选项端口拉线、连线选择。
   数据修改通过 config 回调抛给编辑器，画布本身不持有数据。 */
'use strict';

const Canvas = {
  cfg: null,
  doc: null,
  validation: null,
  nodeEls: new Map(),
  selected: null, // {type:'node', id} | {type:'edge', nodeId, optionId}
  connecting: null, // {nodeId, optionId}
  tempPath: null,
  suppressClick: false,

  init(cfg) {
    this.cfg = cfg;
    this.inner = document.getElementById('canvas-inner');
    this.svg = document.getElementById('edge-layer');
    this.nodesLayer = document.getElementById('nodes-layer');
    this.readOnly = !!cfg.readOnly;

    if (!this.readOnly) {
      this.inner.addEventListener('dblclick', (e) => {
        if (e.target.closest('.node')) return;
        const { x, y } = this.localPoint(e);
        this.cfg.onAddNode(x - 120, y - 40);
      });
      document.addEventListener('keydown', (e) => {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && !typing) {
          e.preventDefault();
          if (this.selected.type === 'edge') {
            this.cfg.onDisconnect(this.selected.nodeId, this.selected.optionId);
          } else if (this.selected.type === 'node') {
            if (confirm('删除该问题节点？相关连线会一并断开。')) {
              this.cfg.onDeleteNode(this.selected.id);
            }
          }
        }
      });
      document.body.addEventListener('canvas:cancel-connect', () => this.cancelConnect());
    }
  },

  localPoint(e) {
    const r = this.inner.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },

  render(doc, validation) {
    this.doc = doc;
    this.validation = validation;
    this.renderNodes();
    this.renderEdges();
  },

  nodeById(id) {
    return (this.doc.nodes || []).find((n) => n.id === id);
  },

  /* ------------------------- 节点 ------------------------- */
  renderNodes() {
    this.nodeEls = new Map();
    this.nodesLayer.innerHTML = '';
    const v = this.validation || {
      cycleNodeIds: [], isolatedNodeIds: [], unreachableNodeIds: [],
    };
    for (const node of this.doc.nodes || []) {
      const el = this.buildNode(node, v);
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      this.nodesLayer.appendChild(el);
      this.nodeEls.set(node.id, el);
    }
  },

  buildNode(node, v) {
    const classes = ['node'];
    if (node.id === this.doc.root) classes.push('is-root');
    if (v.cycleNodeIds.includes(node.id)) classes.push('is-cycle');
    if (v.isolatedNodeIds.includes(node.id)) classes.push('is-isolated');
    if (v.unreachableNodeIds.includes(node.id) && !v.isolatedNodeIds.includes(node.id)) {
      classes.push('is-unreachable');
    }
    if (this.selected && this.selected.type === 'node' && this.selected.id === node.id) {
      classes.push('selected');
    }

    const el = h('div', { class: classes.join(' '), dataset: { nodeId: node.id } });

    // 头部
    const head = h('div', { class: 'node-head' });
    if (!this.readOnly) {
      const inPort = h('span', {
        class: 'in-port',
        title: '连线入口（把选项拖到节点任意位置即可）',
      });
      head.appendChild(inPort);
    }
    const badge = h('span', {
      class: 'node-badge ' + (node.id === this.doc.root ? 'root' : ''),
    }, node.id === this.doc.root ? '起点' : '问题');
    const title = h('input', {
      class: 'node-title',
      value: node.title || '',
      placeholder: '输入问题…',
      dataset: { focusKey: `node-title-${node.id}` },
    });
    if (this.readOnly) { title.readOnly = true; title.tabIndex = -1; }
    title.addEventListener('input', () => this.cfg.onPatchNode(node.id, { title: title.value }));
    head.append(badge, title);

    if (!this.readOnly) {
      if (node.id !== this.doc.root) {
        const setRoot = h('button', {
          class: 'node-menu',
          title: '设为起始问题',
          onclick: (e) => { e.stopPropagation(); this.cfg.onSetRoot(node.id); },
        }, '⚑');
        head.appendChild(setRoot);
      }
      const del = h('button', {
        class: 'node-menu',
        title: '删除节点',
        onclick: (e) => {
          e.stopPropagation();
          if (confirm('删除该问题节点？相关连线会一并断开。')) this.cfg.onDeleteNode(node.id);
        },
      }, '🗑');
      head.appendChild(del);
      this.attachDrag(head, node, el);
    }
    el.appendChild(head);

    // 选项
    const body = h('div', { class: 'node-body' });
    for (const opt of node.options || []) {
      body.appendChild(this.buildOption(node, opt));
    }
    if (!this.readOnly) {
      body.appendChild(h('button', {
        class: 'add-option',
        onclick: (e) => { e.stopPropagation(); this.cfg.onAddOption(node.id); },
      }, '＋ 添加条件选项'));
    }
    el.appendChild(body);

    // 点击/连接目标
    el.addEventListener('click', (e) => {
      if (this.suppressClick) return;
      if (this.connecting) {
        this.finishConnect(node.id);
        return;
      }
      if (e.target.closest('.option-row') || e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      this.select({ type: 'node', id: node.id });
    });

    return el;
  },

  buildOption(node, opt) {
    const v = this.validation;
    const cls = ['option-row'];
    if (opt.terminal) cls.push('terminal');
    if (!opt.terminal && opt.targetId == null &&
        v && v.exitOptionIds.includes(opt.id)) cls.push('has-exit');

    const row = h('div', { class: cls.join(' '), dataset: { optionId: opt.id } });
    const label = h('input', {
      class: 'option-label',
      value: opt.label || '',
      placeholder: '回答/条件，如：是',
      dataset: { focusKey: `option-label-${node.id}-${opt.id}` },
    });
    if (this.readOnly) { label.readOnly = true; label.tabIndex = -1; }
    label.addEventListener('input', () =>
      this.cfg.onPatchOption(node.id, opt.id, { label: label.value }));
    row.appendChild(label);

    if (!this.readOnly) {
      const toggle = h('label', { class: 'option-toggle', title: '勾选后该回答结束访谈，不再跳转' });
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!opt.terminal;
      cb.addEventListener('change', () =>
        this.cfg.onPatchOption(node.id, opt.id, { terminal: cb.checked }));
      cb.addEventListener('click', (e) => e.stopPropagation());
      toggle.append(cb, '结束');
      const rm = h('button', {
        class: 'option-remove',
        title: '删除选项',
        onclick: (e) => { e.stopPropagation(); this.cfg.onRemoveOption(node.id, opt.id); },
      }, '✕');
      row.append(toggle, rm);
    }

    // 端口：编辑模式可交互；只读模式仅作为连线锚点
    const port = h('span', {
      class: 'port' + (this.readOnly ? ' port-readonly' : ''),
      title: this.readOnly ? '' : '按住拖到目标节点完成连接',
      dataset: { optionId: opt.id },
    });
    if (this.readOnly) port.tabIndex = -1;
    if (!this.readOnly) {
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startConnect(node.id, opt.id);
      });
    }
    row.appendChild(port);
    return row;
  },

  /* ------------------------- 拖动节点 ------------------------- */
  attachDrag(handle, node, el) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      if (this.connecting) return;
      e.preventDefault();
      const start = this.localPoint(e);
      const ox = node.x, oy = node.y;
      let moved = false;
      let raf = 0;
      const onMove = (ev) => {
        const p = this.localPoint(ev);
        const nx = ox + p.x - start.x;
        const ny = oy + p.y - start.y;
        if (!moved && (Math.abs(p.x - start.x) > 3 || Math.abs(p.y - start.y) > 3)) moved = true;
        if (!moved) return;
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.renderEdges(); });
        this.cfg.onDragNode(node.id, nx, ny);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          this.suppressClick = true;
          setTimeout(() => (this.suppressClick = false), 0);
          this.cfg.onDragEnd();
          this.renderEdges();
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  /* ------------------------- 拉线连接 ------------------------- */
  startConnect(nodeId, optionId) {
    this.connecting = { nodeId, optionId };
    document.body.classList.add('connecting');
    this.tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempPath.setAttribute('class', 'edge-temp');
    this.svg.appendChild(this.tempPath);

    const start = this.portOut(nodeId, optionId);
    const drawTemp = (x, y) => {
      const dx = Math.max(40, (x - start.x) / 2);
      this.tempPath.setAttribute('d',
        `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${x - dx} ${y}, ${x} ${y}`);
    };
    drawTemp(start.x + 60, start.y);

    const onMove = (ev) => {
      const p = this.localPoint(ev);
      drawTemp(p.x, p.y);
      this.highlightTarget(ev.target);
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const targetEl = ev.target.closest && ev.target.closest('.node');
      if (targetEl) this.finishConnect(targetEl.dataset.nodeId);
      else this.cancelConnect();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  highlightTarget(t) {
    this.nodesLayer.querySelectorAll('.node.target-hot')
      .forEach((n) => n.classList.remove('target-hot'));
    const el = t && t.closest && t.closest('.node');
    if (el && (!this.connecting || el.dataset.nodeId !== this.connecting.nodeId)) {
      el.classList.add('target-hot');
    }
  },

  finishConnect(targetId) {
    const { nodeId, optionId } = this.connecting;
    this.cancelConnect();
    if (targetId === nodeId) {
      toast('不能连接到节点自身', 'error');
      return;
    }
    this.cfg.onPatchOption(nodeId, optionId, { targetId, terminal: false });
  },

  cancelConnect() {
    if (!this.connecting) return;
    this.connecting = null;
    document.body.classList.remove('connecting');
    this.highlightTarget({ closest: () => null });
    if (this.tempPath) { this.tempPath.remove(); this.tempPath = null; }
  },

  /* ------------------------- 连线 ------------------------- */
  portOut(nodeId, optionId) {
    const nodeEl = this.nodeEls.get(nodeId);
    if (!nodeEl) return { x: 0, y: 0 };
    const row = nodeEl.querySelector(`.option-row[data-option-id="${CSS.escape(optionId)}"] .port`);
    if (!row) return { x: 0, y: 0 };
    const nr = this.inner.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return { x: r.left - nr.left + r.width / 2, y: r.top - nr.top + r.height / 2 };
  },

  portIn(nodeId) {
    const nodeEl = this.nodeEls.get(nodeId);
    if (!nodeEl) return { x: 0, y: 0 };
    const nr = this.inner.getBoundingClientRect();
    const r = nodeEl.getBoundingClientRect();
    return { x: r.left - nr.left, y: r.top - nr.top + 22 };
  },

  renderEdges() {
    [...this.svg.querySelectorAll('.edge-path,.edge-label,.edge-label-bg')].forEach((e) => e.remove());
    if (!this.doc) return;
    const cycleSet = new Set((this.validation?.cycleEdges || []).map(([n, o]) => n + '|' + o));
    const sel = this.selected;

    for (const node of this.doc.nodes || []) {
      for (const opt of node.options || []) {
        if (opt.targetId == null) continue;
        if (!this.nodeEls.has(opt.targetId)) continue;
        const a = this.portOut(node.id, opt.id);
        const b = this.portIn(opt.targetId);
        const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
        const isCycle = cycleSet.has(node.id + '|' + opt.id);
        const isSel = sel && sel.type === 'edge' &&
          sel.nodeId === node.id && sel.optionId === opt.id;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d',
          `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - 4} ${b.y}`);
        path.setAttribute('class',
          'edge-path' + (isCycle ? ' cycle' : '') + (isSel ? ' selected' : ''));
        if (!isCycle) path.setAttribute('marker-end', 'url(#arrow)');
        if (!this.readOnly) {
          path.addEventListener('click', (e) => {
            e.stopPropagation();
            this.select({ type: 'edge', nodeId: node.id, optionId: opt.id });
          });
          path.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (confirm('断开这条连线？')) this.cfg.onDisconnect(node.id, opt.id);
          });
        }
        this.svg.appendChild(path);

        // 标签（三次贝塞尔 t=0.5）
        const mx = (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + (b.x - 4)) / 8;
        const my = (a.y + 3 * a.y + 3 * b.y + b.y) / 8;
        const text = opt.label || '未命名';
        const width = this.labelWidth(text);
        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        labelBg.setAttribute('x', mx - width / 2 - 5);
        labelBg.setAttribute('y', my - 9);
        labelBg.setAttribute('width', width + 10);
        labelBg.setAttribute('height', 18);
        labelBg.setAttribute('rx', 5);
        labelBg.setAttribute('class', 'edge-label-bg');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', mx);
        label.setAttribute('y', my + 4);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'edge-label');
        label.textContent = (opt.terminal ? '⏹ ' : '') + text;
        this.svg.append(labelBg, label);
      }
    }
  },

  labelWidth(text) {
    let w = 0;
    const wide = (c) =>
      (c >= 0x1100 && c <= 0x115f) ||
      c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff);
    for (const ch of text) w += wide(ch.codePointAt(0)) ? 12 : 7;
    return Math.min(130, Math.max(22, w));
  },

  /* ------------------------- 选择/定位 ------------------------- */
  select(sel) {
    this.selected = sel;
    this.renderNodes();
    this.renderEdges();
    if (this.cfg.onSelect) this.cfg.onSelect(sel);
  },

  clearSelection() { this.select(null); },

  flashNode(id) {
    const el = this.nodeEls.get(id);
    if (!el) return;
    el.classList.add('flash');
    this.centerOnNode(id);
    setTimeout(() => el.classList.remove('flash'), 1300);
  },

  centerOnNode(id) {
    const el = this.nodeEls.get(id);
    if (!el) return;
    const wrap = document.getElementById('canvas-wrap');
    const nr = el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    wrap.scrollBy({
      left: nr.left - wr.left - wr.width / 2 + nr.width / 2,
      top: nr.top - wr.top - wr.height / 2 + nr.height / 2,
      behavior: 'smooth',
    });
  },

  viewportCenter() {
    const wrap = document.getElementById('canvas-wrap');
    const r = this.inner.getBoundingClientRect();
    return {
      x: wrap.scrollLeft + wrap.clientWidth / 2 - r.left - 120,
      y: wrap.scrollTop + wrap.clientHeight / 2 - r.top - 40,
    };
  },
};
