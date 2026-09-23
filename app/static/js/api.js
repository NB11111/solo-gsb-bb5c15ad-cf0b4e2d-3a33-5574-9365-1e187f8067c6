/* API 封装与通用工具（原生 JS，无依赖） */
'use strict';

const Api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(
        Array.isArray(detail) ? detail.join('；') : detail || `请求失败 (${res.status})`
      );
    }
    return data;
  },

  listScripts() { return this.req('GET', '/api/scripts'); },
  createScript(title) { return this.req('POST', '/api/scripts', { title: title || '' }); },
  getScript(id) { return this.req('GET', `/api/scripts/${id}`); },
  saveScript(id, document) { return this.req('PUT', `/api/scripts/${id}`, { document }); },
  renameScript(id, title) { return this.req('PATCH', `/api/scripts/${id}`, { title }); },
  deleteScript(id) { return this.req('DELETE', `/api/scripts/${id}`); },
  validateScript(id, document) { return this.req('POST', `/api/scripts/${id}/validate`, { document }); },
  importScript(data, title) { return this.req('POST', '/api/scripts/import', { data, title }); },
  exportUrl(id) { return `/api/scripts/${id}/export`; },

  listShares(id) { return this.req('GET', `/api/scripts/${id}/shares`); },
  createShare(id) { return this.req('POST', `/api/scripts/${id}/shares`); },
  revokeShare(token) { return this.req('DELETE', `/api/shares/${token}`); },

  listRuns(id) { return this.req('GET', `/api/scripts/${id}/runs`); },
  saveRun(id, payload) { return this.req('POST', `/api/scripts/${id}/runs`, payload); },

  getShared(token) { return this.req('GET', `/api/share/${token}`); },
};

/* ---------- DOM 辅助 ---------- */
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function toast(msg, type = '') {
  const host = document.getElementById('toast-host');
  const el = h('div', { class: `toast ${type}` }, msg);
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板', 'success');
  } catch (e) {
    const ta = h('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制到剪贴板', 'success');
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function genId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 12);
}

function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  if (e.target.classList && e.target.classList.contains('modal-backdrop')) e.target.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop').forEach((m) => (m.hidden = true));
    document.body.dispatchEvent(new CustomEvent('canvas:cancel-connect'));
  }
});
