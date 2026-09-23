/* 访谈运行预览：按回答在节点间跳转并记录完整路径。 */
'use strict';

const Runner = {
  doc: null,
  stack: null,

  start(doc, opts = {}) {
    this.doc = doc;
    this.readOnly = !!opts.readOnly;
    this.onFinish = opts.onFinish || null;
    this.saved = false;
    this.stack = [{ nodeId: doc.root, path: [] }];
    openModal('run-modal');
    this.render();
  },

  get current() { return this.stack[this.stack.length - 1]; },

  node(id) { return (this.doc.nodes || []).find((n) => n.id === id); },

  choose(opt) {
    const cur = this.current;
    cur.path.push({
      nodeId: cur.nodeId,
      optionId: opt.id,
      answer: opt.label || '',
      title: this.node(cur.nodeId)?.title || '',
    });

    if (opt.terminal || opt.targetId == null || !this.node(opt.targetId)) {
      // 结束分支：标记最终节点
      cur.path[cur.path.length - 1].terminal = true;
      this.finish(true);
      return;
    }
    this.stack.push({ nodeId: opt.targetId, path: cur.path });
    this.render();
  },

  back() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    // 各栈帧共享同一 path 数组，弹栈时同时撤销上一次回答
    this.current.path.pop();
    document.getElementById('run-end').hidden = true;
    this.render();
  },

  async finish(finished) {
    document.getElementById('run-end').hidden = false;
    document.getElementById('run-options').innerHTML = '';
    const backBtn = document.getElementById('run-back');
    if (backBtn) backBtn.hidden = true;
    document.getElementById('run-question').textContent = finished
      ? '已走到结束分支'
      : '访谈已终止';
    this.renderBreadcrumb();
    if (!this.saved && this.onFinish) {
      this.saved = true;
      try { await this.onFinish(this.current.path, finished); }
      catch (e) { toast('运行记录保存失败：' + e.message, 'error'); this.saved = false; }
    }
  },

  render() {
    document.getElementById('run-end').hidden = true;
    const backBtn = document.getElementById('run-back');
    if (backBtn) backBtn.hidden = this.stack.length <= 1;
    const node = this.node(this.current?.nodeId);
    const qBox = document.getElementById('run-question');
    const oBox = document.getElementById('run-options');
    oBox.innerHTML = '';

    if (!node) {
      qBox.textContent = '⚠️ 无法开始：起始节点缺失（请先在校验面板修复）';
      this.renderBreadcrumb();
      return;
    }
    qBox.innerHTML = '';
    qBox.append(
      h('span', { class: 'run-step-tag' }, `第 ${this.stack.length} 问`),
      document.createTextNode(node.title || '（未命名问题）')
    );
    const options = node.options || [];
    if (options.length === 0) {
      oBox.appendChild(h('button', {
        class: 'run-option terminal',
        onclick: () => this.choose({ id: null, label: '', terminal: true }),
      }, '（无选项）结束访谈'));
    }
    for (const opt of options) {
      oBox.appendChild(h('button', {
        class: 'run-option' + (opt.terminal ? ' terminal' : ''),
        onclick: () => this.choose(opt),
      }, (opt.terminal ? '⏹ ' : '') + (opt.label || '未命名选项') +
        (opt.targetId && !opt.terminal ? '  →' : '')));
    }
    this.renderBreadcrumb();
  },

  renderBreadcrumb() {
    const path = this.current?.path || [];
    const el = document.getElementById('run-breadcrumb');
    if (path.length === 0) {
      el.textContent = '路径：（起点）';
      return;
    }
    const labels = path.map((s, i) => `${i + 1}. ${s.answer || '结束'}`);
    el.textContent = '路径：' + labels.join(' › ');
  },

  getPathJson() {
    return JSON.stringify(this.current?.path || [], null, 2);
  },

  bindStatic() {
    document.getElementById('run-abort').addEventListener('click', () => this.finish(false));
    const backBtn = document.getElementById('run-back');
    if (backBtn) backBtn.addEventListener('click', () => this.back());
    document.getElementById('run-copy-path').addEventListener('click', () =>
      copyText(this.getPathJson()));
    document.getElementById('run-restart').addEventListener('click', () => {
      this.start(this.doc, { readOnly: this.readOnly, onFinish: this.onFinish });
    });
  },
};

Runner.bindStatic();
