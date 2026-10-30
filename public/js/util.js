export const state = { settings: { currency: 'EUR', locale: 'es-ES' }, categories: [] };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function loadCategories() {
  state.categories = await api('/categories');
  return state.categories;
}

export function money(n, { sign = false, decimals } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const d = decimals ?? (abs >= 10000 ? 0 : 2);
  const s = new Intl.NumberFormat(state.settings.locale, {
    style: 'currency', currency: state.settings.currency, minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(n);
  return sign && n > 0 ? `+${s}` : s;
}

export function compactMoney(n) {
  return new Intl.NumberFormat(state.settings.locale, {
    style: 'currency', currency: state.settings.currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(n);
}

export const pct = (n, d = 0) => (n === null || n === undefined || !isFinite(n) ? '—' : `${(n * 100).toFixed(d)}%`);

export function monthLabel(month, style = 'short') {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(state.settings.locale, { month: style, year: style === 'long' ? 'numeric' : '2-digit' });
}

export function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(state.settings.locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export const currentMonth = () => new Date().toISOString().slice(0, 7);
export const today = () => new Date().toISOString().slice(0, 10);
export function addMonths(month, n) {
  let [y, m] = month.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, isError ? 5000 : 2800);
}

// Wrap an async handler so errors surface as a toast instead of disappearing.
export const guard = fn => async (...args) => {
  try { return await fn(...args); } catch (err) { console.error(err); toast(err.message, true); }
};

/**
 * Open a modal. `body` is HTML; `onSubmit(form)` returns truthy/undefined to close, false to keep open.
 */
export function modal({ title, body, submitLabel = 'Save', onSubmit, danger, extraButtons = '' }) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <form method="dialog">
      <div class="modal-head">${esc(title)}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${extraButtons}
        <span style="flex:1"></span>
        <button type="button" data-cancel>Cancel</button>
        ${onSubmit ? `<button type="submit" class="${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector('form');
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-cancel]').onclick = close;
  dlg.addEventListener('cancel', () => dlg.remove());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return close();
    try {
      const result = await onSubmit(form);
      if (result !== false) close();
    } catch (err) { toast(err.message, true); }
  });
  dlg.showModal();
  dlg.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return { dlg, form, close };
}

export function confirmDialog(title, message, label = 'Delete') {
  return new Promise(resolve => {
    const { dlg } = modal({ title, body: `<p style="margin:0">${message}</p>`, submitLabel: label, danger: true, onSubmit: () => resolve(true) });
    dlg.addEventListener('close', () => resolve(false));
  });
}

export const formData = form => Object.fromEntries(new FormData(form).entries());

export function categoryOptions(selectedId, { includeEmpty = false, emptyLabel = 'All categories' } = {}) {
  const groups = { income: 'Income', expense: 'Expenses', transfer: 'Transfers (excluded from totals)' };
  let html = includeEmpty ? `<option value="">${esc(emptyLabel)}</option>` : '';
  for (const [kind, label] of Object.entries(groups)) {
    const cats = state.categories.filter(c => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    if (!cats.length) continue;
    html += `<optgroup label="${label}">${cats.map(c =>
      `<option value="${c.id}" ${Number(selectedId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  }
  return html;
}

export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- Charts ---------- */

const charts = new Set();
export function destroyCharts() { charts.forEach(c => c.destroy()); charts.clear(); }

export function chart(canvas, config) {
  const Chart = window.Chart;
  const text = cssVar('--text-secondary');
  const grid = cssVar('--grid');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = text;
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface-1'), titleColor: cssVar('--text-primary'), bodyColor: cssVar('--text-secondary'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${money(ctx.parsed.y ?? ctx.parsed.x)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: grid }, ticks: { color: text, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: text, callback: v => compactMoney(v) } },
    },
  };
  const merged = deepMerge(base, config.options || {});
  const instance = new Chart(canvas, { ...config, options: merged });
  charts.add(instance);
  return instance;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}

export const legendHTML = items =>
  `<div class="legend">${items.map(([label, color]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
