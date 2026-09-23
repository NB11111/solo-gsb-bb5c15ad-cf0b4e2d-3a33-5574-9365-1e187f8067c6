/* 只读分享页：查看流程、查看校验、本地运行预览（路径不上报）。 */
'use strict';

(async function initShare() {
  const token = location.pathname.split('/').pop();
  let data;
  try {
    data = await Api.getShared(token);
  } catch (e) {
    document.getElementById('share-title').textContent = '链接无效';
    document.querySelector('.canvas-inner')?.insertAdjacentHTML(
      'beforeend',
      `<div style="position:absolute;left:40px;top:60px;color:#e5484d;font-size:16px;">❌ ${esc(e.message)}</div>`
    );
    document.getElementById('btn-run').disabled = true;
    document.getElementById('btn-export').disabled = true;
    const list = document.getElementById('issue-list');
    if (list) list.innerHTML = '';
    const sum = document.getElementById('validation-summary');
    if (sum) {
      sum.className = 'validation-summary has-error';
      sum.textContent = '❌ ' + e.message;
    }
    return;
  }

  document.getElementById('share-title').textContent = data.title;
  document.title = `${data.title} · 只读访谈`;

  Canvas.init({ readOnly: true });
  Canvas.render(data.document, data.validation);
  renderPanel(data.validation);

  document.getElementById('btn-run').addEventListener('click', () => {
    Runner.start(data.document, {
      readOnly: true,
      onFinish: null, // 只读页不上报运行记录
    });
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    downloadJson(`${(data.title || '访谈脚本').replace(/[\\/:*?"<>|\s]+/g, '_')}.json`, {
      version: 1,
      kind: 'branch-interview-script',
      title: data.title,
      document: data.document,
      shared: true,
    });
  });

  document.getElementById('btn-validate').addEventListener('click', () => {
    const v = data.validation;
    if (v.errorCount === 0 && v.warningCount === 0) toast('🔍 校验通过', 'success');
    else toast(`🔍 ${v.errorCount} 个错误、${v.warningCount} 个警告`);
  });

  function renderPanel(v) {
    const sum = document.getElementById('validation-summary');
    const list = document.getElementById('issue-list');
    sum.className = 'validation-summary';
    if (v.errorCount === 0 && v.warningCount === 0) {
      sum.classList.add('ok');
      sum.textContent = '✅ 全部通过：没有环路、孤立节点或未覆盖出口';
      return;
    }
    sum.classList.add(v.errorCount > 0 ? 'has-error' : 'has-warn');
    sum.textContent = `❌ ${v.errorCount} 个错误 · ⚠️ ${v.warningCount} 个警告`;
    for (const issue of v.issues) {
      list.appendChild(h('li', {
        class: `issue-item ${issue.severity}`,
        onclick: () => {
          const nid = issue.nodeIds && issue.nodeIds[0];
          if (nid) Canvas.flashNode(nid);
        },
      }, [
        h('span', { class: 'issue-code' },
          (issue.severity === 'error' ? '❌ 错误 · ' : '⚠️ 警告 · ') + issue.code),
        h('div', {}, issue.message),
      ]));
    }
  }
})();
