/* 编辑器主编排：状态、保存、工具栏、校验面板、分享与运行记录。 */
'use strict';

const Editor = {
  scripts: [],
  currentId: null,
  title: '',
  doc: { root: null, nodes: [] },
  validation: null,
  dirty: false,

  /* ------------------------- 启动 ------------------------- */
  async init() {
    Canvas.init({
      onAddNode: (x, y) => this.addNode(x, y),
      onDeleteNode: (id) => this.deleteNode(id),
      onSetRoot: (id) => this.setRoot(id),
      onPatchNode: (id, patch) => this.patchNode(id, patch),
      onDragNode: (id, x, y) => {
        const n = this.doc.nodes.find((z) => z.id === id);
        if (n) { n.x = x; n.y = y; }
      },
      onDragEnd: () => this.scheduleSave(true),
      onAddOption: (nodeId) => this.addOption(nodeId),
      onRemoveOption: (nodeId, optId) => this.removeOption(nodeId, optId),
      onPatchOption: (nodeId, optId, patch) => this.patchOption(nodeId, optId, patch),
      onDisconnect: (nodeId, optId) => {
        Canvas.clearSelection();
        this.patchOption(nodeId, optId, { targetId: null });
      },
    });
    this.bindTopbar();
    this.refreshLocal();
    try {
      this.scripts = await Api.listScripts();
      await this.refreshSelect();
      if (this.scripts.length) await this.load(this.scripts[0].id);
      else {
        const created = await Api.createScript();
        this.scripts = await Api.listScripts();
        await this.refreshSelect(created.id);
        await this.load(created.id);
        this.dirty = false;
      }
    } catch (e) {
      toast('加载失败：' + e.message, 'error');
    }

    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  },

  /* ------------------------- 列表 ------------------------- */
  async refreshSelect(selectId) {
    const sel = document.getElementById('script-select');
    sel.innerHTML = '';
    for (const s of this.scripts) {
      const tag = (s.errorCount ? `❌${s.errorCount} ` : '') +
        (s.warningCount ? `⚠️${s.warningCount}` : '');
      sel.appendChild(h('option', { value: s.id },
        `${s.title}${tag ? '  (' + tag.trim() + ')' : ''}`));
    }
    sel.value = String(selectId || this.currentId);
  },

  async load(id) {
    this.currentId = id;
    const script = await Api.getScript(id);
    this.title = script.title;
    this.doc = script.document;
    this.validation = script.validation;
    this.dirty = false;
    document.getElementById('title-input').value = this.title;
    document.getElementById('script-select').value = String(id);
    Canvas.render(this.doc, this.validation);
    this.renderValidationPanel();
    this.setDirty(false);
  },

  /* ------------------------- 脏状态 / 保存 ------------------------- */
  setDirty(v) {
    this.dirty = v;
    document.getElementById('dirty-dot').classList.toggle('dirty', v);
  },

  mutate() {
    this.refreshLocal();
    this.setDirty(true);
    this.scheduleSave();
  },

  scheduleSave(immediate = false) {
    clearTimeout(this._timer);
    const delay = immediate ? 0 : 700;
    this._timer = setTimeout(() => this.save(), delay);
  },

  async save(silent = false) {
    if (!this.currentId || !this.dirty) return;
    const doc = this.doc;
    try {
      const saved = await Api.saveScript(this.currentId, doc);
      this.validation = saved.validation;
      this.title = saved.title;
      this.preserveFocus(() => Canvas.render(this.doc, this.validation));
      this.renderValidationPanel();
      this.setDirty(false);
      this.scripts = await Api.listScripts();
      await this.refreshSelect();
      if (!silent) toast('已保存', 'success');
    } catch (e) {
      toast('保存失败：' + e.message, 'error');
    }
  },

  /* ------------------------- 本地校验 ------------------------- */
  refreshLocal() {
    this.validation = Validator.validate(this.doc);
    this.preserveFocus(() => Canvas.render(this.doc, this.validation));
    this.renderValidationPanel();
  },

  // 输入过程中会全量重渲染节点；保持正在编辑的输入框焦点与光标位置
  preserveFocus(fn) {
    const active = document.activeElement;
    const focusKey = active && active.dataset && active.dataset.focusKey;
    let caret = null;
    if (focusKey && active.tagName === 'INPUT') {
      caret = active.selectionStart;
    }
    fn();
    if (focusKey) {
      const next = document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      if (next) {
        next.focus();
        if (caret != null) {
          const pos = Math.min(caret, next.value.length);
          next.setSelectionRange(pos, pos);
        }
      }
    }
  },

  renderValidationPanel() {
    const v = this.validation;
    const sum = document.getElementById('validation-summary');
    const list = document.getElementById('issue-list');
    list.innerHTML = '';
    sum.className = 'validation-summary';
    if (!v) return;

    if (v.errorCount === 0 && v.warningCount === 0) {
      sum.classList.add('ok');
      sum.textContent = '✅ 全部通过：没有环路、孤立节点或未覆盖出口';
    } else if (v.errorCount > 0) {
      sum.classList.add('has-error');
      sum.textContent = `❌ ${v.errorCount} 个错误 · ⚠️ ${v.warningCount} 个警告`;
    } else {
      sum.classList.add('has-warn');
      sum.textContent = `⚠️ ${v.warningCount} 个警告（不影响保存）`;
    }

    for (const issue of v.issues) {
      const li = h('li', {
        class: `issue-item ${issue.severity}`,
        title: '点击定位到相关节点',
        onclick: () => {
          const nid = issue.nodeIds && issue.nodeIds[0];
          if (nid) {
            Canvas.flashNode(nid);
            Canvas.select({ type: 'node', id: nid });
          }
        },
      }, [
        h('span', { class: 'issue-code' },
          (issue.severity === 'error' ? '❌ 错误 · ' : '⚠️ 警告 · ') + issue.code),
        h('div', {}, issue.message),
      ]);
      list.appendChild(li);
    }
  },

  /* ------------------------- 数据操作 ------------------------- */
  addNode(x, y) {
    const p = x == null ? Canvas.viewportCenter() : { x, y };
    const node = {
      id: genId('n'),
      type: 'question',
      title: '新问题',
      x: Math.max(0, p.x),
      y: Math.max(0, p.y),
      options: [{ id: genId('o'), label: '选项', terminal: false, targetId: null }],
    };
    this.doc.nodes.push(node);
    if (this.doc.root == null) this.doc.root = node.id;
    this.mutate();
    Canvas.flashNode(node.id);
  },

  deleteNode(id) {
    const node = this.doc.nodes.find((n) => n.id === id);
    if (!node) return;
    this.doc.nodes = this.doc.nodes.filter((n) => n.id !== id);
    for (const n of this.doc.nodes) {
      for (const o of n.options || []) {
        if (o.targetId === id) o.targetId = null;
      }
    }
    if (this.doc.root === id) this.doc.root = this.doc.nodes[0]?.id ?? null;
    Canvas.clearSelection();
    this.mutate();
  },

  setRoot(id) {
    this.doc.root = id;
    this.mutate();
  },

  patchNode(id, patch) {
    const node = this.doc.nodes.find((n) => n.id === id);
    if (!node) return;
    Object.assign(node, patch);
    this.mutate();
  },

  addOption(nodeId) {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.options.push({ id: genId('o'), label: '新选项', terminal: false, targetId: null });
    this.mutate();
  },

  removeOption(nodeId, optId) {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.options = node.options.filter((o) => o.id !== optId);
    this.mutate();
  },

  patchOption(nodeId, optId, patch) {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    const opt = node?.options.find((o) => o.id === optId);
    if (!opt) return;
    Object.assign(opt, patch);
    if (patch.terminal) opt.targetId = null;
    this.mutate();
  },

  /* ------------------------- 工具栏 ------------------------- */
  bindTopbar() {
    document.getElementById('script-select').addEventListener('change', async (e) => {
      if (this.dirty && !confirm('有未保存修改（自动保存可能仍在进行），确定切换？')) {
        e.target.value = String(this.currentId);
        return;
      }
      await this.load(Number(e.target.value));
    });

    document.getElementById('btn-new').addEventListener('click', async () => {
      try {
        const created = await Api.createScript();
        this.scripts = await Api.listScripts();
        await this.refreshSelect(created.id);
        await this.load(created.id);
        toast('已新建脚本', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    const titleInput = document.getElementById('title-input');
    titleInput.addEventListener('input', () => { this.title = titleInput.value; });
    titleInput.addEventListener('change', async () => {
      if (!this.currentId) return;
      try {
        await Api.renameScript(this.currentId, titleInput.value);
        this.scripts = await Api.listScripts();
        await this.refreshSelect();
        toast('标题已更新', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('btn-add-node').addEventListener('click', () => {
      const c = Canvas.viewportCenter();
      this.addNode(c.x, c.y);
    });
    document.getElementById('btn-save').addEventListener('click', () => this.save());
    document.getElementById('btn-validate').addEventListener('click', async () => {
      await this.save(true);
      const v = this.validation;
      if (v.errorCount === 0 && v.warningCount === 0) toast('🔍 校验通过', 'success');
      else toast(`🔍 ${v.errorCount} 个错误、${v.warningCount} 个警告`);
    });

    document.getElementById('btn-run').addEventListener('click', () => {
      if (!this.validation || this.validation.errorCount > 0) {
        if (!confirm('脚本存在校验错误，运行可能中断。仍然继续？')) return;
      }
      Runner.start(this.doc, {
        onFinish: (path, finished) =>
          Api.saveRun(this.currentId, { source: 'preview', finished, path }),
      });
    });

    document.getElementById('btn-export').addEventListener('click', async () => {
      await this.save(true);
      const payload = await Api.req('GET', Api.exportUrl(this.currentId));
      const safe = (this.title || '访谈脚本').replace(/[\\/:*?"<>|\s]+/g, '_');
      downloadJson(`${safe}.json`, payload);
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const imported = await Api.importScript(data, data.title);
        this.scripts = await Api.listScripts();
        await this.refreshSelect(imported.id);
        await this.load(imported.id);
        toast('导入成功', 'success');
      } catch (err) {
        toast('导入失败：' + err.message, 'error');
      }
    });

    document.getElementById('btn-share').addEventListener('click', () => this.openShares());
    document.getElementById('share-create').addEventListener('click', () => this.createShare());
    document.getElementById('btn-runs').addEventListener('click', () => this.openRuns());

    document.getElementById('btn-delete').addEventListener('click', async () => {
      if (!confirm(`确定删除「${this.title}」？分享链接与运行记录会一并删除。`)) return;
      try {
        await Api.deleteScript(this.currentId);
        this.scripts = await Api.listScripts();
        if (this.scripts.length) {
          await this.refreshSelect(this.scripts[0].id);
          await this.load(this.scripts[0].id);
        } else {
          const created = await Api.createScript();
          this.scripts = await Api.listScripts();
          await this.refreshSelect(created.id);
          await this.load(created.id);
        }
        toast('已删除', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  },

  /* ------------------------- 分享 ------------------------- */
  async openShares() {
    await this.save(true);
    openModal('share-modal');
    await this.refreshShares();
  },

  async refreshShares() {
    const list = document.getElementById('share-list');
    list.innerHTML = '';
    const shares = await Api.listShares(this.currentId);
    if (!shares.length) {
      list.appendChild(h('li', { class: 'muted' }, '还没有分享链接。'));
      return;
    }
    for (const s of shares) {
      const link = h('a', {
        class: 'share-url', href: s.url, target: '_blank', rel: 'noopener',
      }, s.url);
      const item = h('li', { class: 'share-item' }, [
        link,
        h('span', { class: 'share-meta' }, s.createdAt),
        h('button', { class: 'btn', onclick: () => copyText(s.url) }, '复制'),
        h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            if (!confirm('撤销该链接后，持有者将无法再打开。')) return;
            await Api.revokeShare(s.token);
            toast('链接已撤销', 'success');
            await this.refreshShares();
          },
        }, '撤销'),
      ]);
      list.appendChild(item);
    }
  },

  async createShare() {
    await Api.createShare(this.currentId);
    await this.refreshShares();
    toast('只读链接已生成', 'success');
  },

  /* ------------------------- 运行记录 ------------------------- */
  async openRuns() {
    openModal('runs-modal');
    const list = document.getElementById('runs-list');
    list.innerHTML = '';
    const runs = await Api.listRuns(this.currentId);
    if (!runs.length) {
      list.appendChild(h('li', { class: 'muted' }, '还没有运行记录。'));
      return;
    }
    for (const run of runs) {
      const steps = run.path.map((s, i) =>
        `${i + 1}. ${s.title || s.nodeId} → ${s.answer || '结束'}`).join('\n');
      const meta = `${run.startedAt} · ${run.path.length} 步`;
      const item = h('li', { class: 'run-record' }, [
        h('summary', {}, [
          meta,
          h('span', { class: 'tag ' + (run.finished ? 'finished' : 'aborted') },
            run.finished ? '正常结束' : '手动终止'),
        ]),
        h('pre', { class: 'run-path' }, steps || '（未记录任何回答）'),
      ]);
      list.appendChild(item);
    }
  },
};

Editor.init();
