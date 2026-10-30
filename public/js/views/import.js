import { api, state, money, dateLabel, esc, toast, guard, confirmDialog, categoryOptions, loadCategories } from '../util.js';

const FIELD_HINTS = {
  date: ['fecha operacion', 'f. operacion', 'fecha', 'date', 'transaction date', 'booking date', 'fecha valor', 'f. valor'],
  concept: ['concepto', 'descripcion', 'description', 'detalle', 'movimiento', 'concept', 'details', 'memo', 'payee', 'narrative'],
  extra: ['observaciones', 'mas datos', 'referencia', 'reference', 'info adicional', 'notes'],
  amount: ['importe', 'amount', 'cantidad', 'monto', 'importe eur'],
  debit: ['cargo', 'cargos', 'debe', 'debit', 'gasto', 'withdrawal', 'paid out', 'money out'],
  credit: ['abono', 'abonos', 'haber', 'credit', 'ingreso', 'deposit', 'paid in', 'money in'],
  balance: ['saldo', 'balance', 'disponible', 'running balance'],
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function scoreHeader(cell, hints) {
  const c = norm(cell);
  if (!c) return 0;
  let best = 0;
  hints.forEach((h, i) => {
    const s = c === h ? 100 - i : c.startsWith(h) ? 60 - i : c.includes(h) ? 40 - i : 0;
    best = Math.max(best, s);
  });
  return best;
}

// The header row is the first one (in the top 40) that has both a date-like and an amount-like column name.
function findHeaderRow(aoa) {
  let fallback = 0;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const row = aoa[i] || [];
    const hasDate = row.some(c => scoreHeader(c, FIELD_HINTS.date) > 0);
    const hasMoney = row.some(c => scoreHeader(c, [...FIELD_HINTS.amount, ...FIELD_HINTS.debit, ...FIELD_HINTS.credit]) > 0);
    if (hasDate && hasMoney) return i;
    if (!fallback && row.filter(c => String(c).trim()).length >= 3) fallback = i;
  }
  return fallback;
}

function guessMapping(headers) {
  const used = new Set();
  const pick = field => {
    let best = -1, bestScore = 0;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      // A date column ("F. Valor", "Value date") is never the amount/concept/balance.
      if (field !== 'date' && scoreHeader(h, FIELD_HINTS.date) > 0) return;
      const s = scoreHeader(h, FIELD_HINTS[field]);
      if (s > bestScore) { best = i; bestScore = s; }
    });
    if (best >= 0) used.add(best);
    return best;
  };
  const m = { date: pick('date'), concept: pick('concept'), amount: pick('amount'), balance: pick('balance') };
  m.debit = m.amount < 0 ? pick('debit') : -1;
  m.credit = m.amount < 0 ? pick('credit') : -1;
  m.extra = pick('extra');
  m.mode = m.amount < 0 && (m.debit >= 0 || m.credit >= 0) ? 'split' : 'single';
  m.dateFormat = 'auto';
  m.invert = false;
  return m;
}

// Some banks split the running balance in two columns: positive in "Saldo (+)", overdrawn in "Saldo (-)".
function detectSplitBalance(headers) {
  let pos = -1, neg = -1;
  headers.forEach((h, i) => {
    if (!scoreHeader(h, FIELD_HINTS.balance)) return;
    const n = norm(h);
    if (pos < 0 && /\(\+\)|acreedor|positiv/.test(n)) pos = i;
    else if (neg < 0 && /\(\s*[-−]\s*\)|deudor|negativ/.test(n)) neg = i;
  });
  return pos >= 0 && neg >= 0 ? { pos, neg } : null;
}

// Fill balance settings for new guesses and for layouts saved before split balances existed.
function withBalanceMode(m, headers) {
  if (m.balanceMode) return m;
  const split = detectSplitBalance(headers);
  return split
    ? { ...m, balanceMode: 'split', balancePos: split.pos, balanceNeg: split.neg }
    : { ...m, balanceMode: 'single', balancePos: -1, balanceNeg: -1 };
}

function parseDate(v, format) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = window.XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y, mo, d;
  if (m) [, y, mo, d] = m.map(Number);
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) return null;
    let [, a, b, c] = m.map(Number);
    y = c < 100 ? 2000 + c : c;
    const mdy = format === 'MDY' || (format === 'auto' && b > 12 && a <= 12);
    [d, mo] = mdy ? [b, a] : [a, b];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  s = s.replace(/[^\d,.\-+]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  s = s.replace(/^\+/, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=.*,)/g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s) && state.settings.locale.startsWith('es')) {
    s = s.replace(/\./g, ''); // "1.250" in a Spanish statement is one thousand two hundred fifty
  }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

export default async function importView(root) {
  const [imports, accounts] = await Promise.all([api('/imports'), api('/accounts')]);
  let workbook, filename, aoa, headerRow, headers, mapping, preview = [];

  root.innerHTML = `
    <div class="page-head"><h1>Import bank statement</h1></div>
    <div id="step1" class="card">
      <label class="dropzone" id="drop">
        <input type="file" id="file" accept=".xlsx,.xls,.csv,.ods" hidden>
        <div style="font-size:16px;font-weight:600">Drop your statement here or click to choose a file</div>
        <div class="subtle" style="margin-top:6px">Excel (.xlsx, .xls), CSV or ODS exported from your bank.
          The file is read locally; re-importing an overlapping statement won’t create duplicates.</div>
      </label>
    </div>
    <div id="step2" class="card" style="display:none;margin-top:16px"></div>
    <div id="step3" style="display:none;margin-top:16px"></div>
    <div class="card" style="margin-top:16px">
      <h2>Previous imports</h2>
      ${imports.length ? `<div class="table-wrap"><table>
        <thead><tr><th>File</th><th>Imported</th><th>Period</th><th class="num">Rows</th><th class="num">Duplicates skipped</th><th></th></tr></thead>
        <tbody>${imports.map(i => `<tr>
          <td>${esc(i.filename || '—')}</td><td>${esc(i.imported_at.slice(0, 16))}</td>
          <td>${i.first_date ? `${esc(dateLabel(i.first_date))} – ${esc(dateLabel(i.last_date))}` : '—'}</td>
          <td class="num">${i.row_count}</td><td class="num">${i.skipped}</td>
          <td class="num"><button class="link danger" data-undo="${i.id}">Undo import</button></td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="muted">No imports yet.</div>'}
    </div>`;

  const $ = s => root.querySelector(s);
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('#file').onchange = e => e.target.files[0] && readFile(e.target.files[0]);

  root.querySelectorAll('[data-undo]').forEach(b => b.onclick = guard(async () => {
    if (!await confirmDialog('Undo import', 'Delete every transaction that came from this import?')) return;
    await api(`/imports/${b.dataset.undo}`, { method: 'DELETE' });
    toast('Import removed');
    importView(root);
  }));

  const readFile = guard(async file => {
    filename = file.name;
    const buf = await file.arrayBuffer();
    workbook = window.XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    loadSheet(workbook.SheetNames[0]);
  });

  function loadSheet(name) {
    aoa = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    headerRow = findHeaderRow(aoa);
    setupHeaders(name);
  }

  function setupHeaders(sheetName) {
    headers = (aoa[headerRow] || []).map((h, i) => String(h).trim() || `Column ${i + 1}`);
    const saved = state.settings.importMapping?.[headers.join('|')];
    mapping = withBalanceMode(saved ? { ...saved } : guessMapping(headers), headers);
    drawMapping(sheetName);
  }

  function drawMapping(sheetName) {
    const colSelect = (field, optional) => `<select data-map="${field}">
      ${optional ? '<option value="-1">— none —</option>' : ''}
      ${headers.map((h, i) => `<option value="${i}" ${mapping[field] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
    const sample = aoa.slice(headerRow + 1, headerRow + 6);
    const cashAccounts = accounts.filter(a => a.type === 'cash' || a.type === 'savings');
    const balanceAcc = state.settings.balanceAccountId;
    const step2 = $('#step2');
    step2.style.display = '';
    step2.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">2 · Map columns <span class="muted small">${esc(filename)}</span></h2>
        ${workbook.SheetNames.length > 1 ? `<label class="row small">Sheet <select id="sheet">${workbook.SheetNames.map(n => `<option ${n === sheetName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      </div>
      <p class="small subtle">Columns were detected automatically — check they’re right. Your choices are remembered for files with the same layout.</p>
      <div class="form-grid">
        <label class="field">Header row<input type="number" id="headerRow" min="1" max="${aoa.length}" value="${headerRow + 1}"></label>
        <label class="field">Date column${colSelect('date')}</label>
        <label class="field">Date format<select data-map="dateFormat">
          ${[['auto', 'Auto-detect'], ['DMY', 'DD/MM/YYYY'], ['MDY', 'MM/DD/YYYY']].map(([v, l]) => `<option value="${v}" ${mapping.dateFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Concept column${colSelect('concept')}</label>
        <label class="field">Extra description (optional)${colSelect('extra', true)}</label>
        <label class="field">Amount is in<select data-map="mode">
          <option value="single" ${mapping.mode === 'single' ? 'selected' : ''}>One column (+/−)</option>
          <option value="split" ${mapping.mode === 'split' ? 'selected' : ''}>Separate debit / credit columns</option></select></label>
        ${mapping.mode === 'single'
          ? `<label class="field">Amount column${colSelect('amount')}</label>`
          : `<label class="field">Debit (money out)${colSelect('debit', true)}</label><label class="field">Credit (money in)${colSelect('credit', true)}</label>`}
        <label class="field">Balance is in<select data-map="balanceMode">
          <option value="single" ${mapping.balanceMode !== 'split' ? 'selected' : ''}>One column (+/−)</option>
          <option value="split" ${mapping.balanceMode === 'split' ? 'selected' : ''}>Two columns: positive / overdrawn</option></select></label>
        ${mapping.balanceMode === 'split'
          ? `<label class="field">Balance (+) column${colSelect('balancePos', true)}</label><label class="field">Balance (−) column (overdrawn)${colSelect('balanceNeg', true)}</label>`
          : `<label class="field">Balance column (optional)${colSelect('balance', true)}</label>`}
        <label class="field">Track balance in account<select id="balanceAccount">
          <option value="">— don’t track —</option>
          ${cashAccounts.map(a => `<option value="${a.id}" ${balanceAcc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          <option value="new">+ New cash account…</option></select></label>
      </div>
      <label class="row small" style="margin-top:10px;gap:6px"><input type="checkbox" data-map="invert" ${mapping.invert ? 'checked' : ''}>
        Invert signs (use if your bank shows expenses as positive numbers)</label>
      <h3 style="margin-top:16px">File preview</h3>
      <div class="table-wrap"><table class="small">
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${sample.map(r => `<tr>${headers.map((_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="primary" id="toPreview">Continue →</button></div>`;

    step2.querySelector('#sheet')?.addEventListener('change', e => loadSheet(e.target.value));
    step2.querySelector('#headerRow').onchange = e => { headerRow = Math.max(0, Number(e.target.value) - 1); setupHeaders(sheetName); };
    step2.querySelectorAll('[data-map]').forEach(el => el.onchange = () => {
      const k = el.dataset.map;
      mapping[k] = el.type === 'checkbox' ? el.checked : ['mode', 'dateFormat', 'balanceMode'].includes(k) ? el.value : Number(el.value);
      if (k === 'mode' || k === 'balanceMode') drawMapping(sheetName);
    });
    step2.querySelector('#toPreview').onclick = guard(buildPreview);
  }

  function readBalance(r) {
    if (mapping.balanceMode !== 'split') return mapping.balance >= 0 ? parseAmount(r[mapping.balance]) : null;
    const pos = mapping.balancePos >= 0 ? parseAmount(r[mapping.balancePos]) : null;
    const neg = mapping.balanceNeg >= 0 ? parseAmount(r[mapping.balanceNeg]) : null;
    // Overdrawn rows leave the (+) column empty (or 0); the (-) column may hold 404.10 or -404.10.
    if (neg && !pos) return -Math.abs(neg);
    return pos;
  }

  function extractRows() {
    const out = [];
    for (const r of aoa.slice(headerRow + 1)) {
      const date = parseDate(r[mapping.date], mapping.dateFormat);
      let amount;
      if (mapping.mode === 'single') amount = parseAmount(r[mapping.amount]);
      else {
        const debit = mapping.debit >= 0 ? parseAmount(r[mapping.debit]) : null;
        const credit = mapping.credit >= 0 ? parseAmount(r[mapping.credit]) : null;
        amount = debit || credit ? (credit || 0) - Math.abs(debit || 0) : null;
      }
      if (amount !== null && mapping.invert) amount = -amount;
      let concept = String(r[mapping.concept] ?? '').trim();
      if (mapping.extra >= 0 && String(r[mapping.extra] ?? '').trim()) concept = `${concept} ${String(r[mapping.extra]).trim()}`.trim();
      if (!date || amount === null || !concept) continue;
      out.push({ date, concept, amount: Math.round(amount * 100) / 100, balance: readBalance(r) });
    }
    return out;
  }

  async function buildPreview() {
    const rows = extractRows();
    if (!rows.length) throw new Error('No valid rows found — check the date, concept and amount columns.');
    // Remember this layout for next time.
    const importMapping = { ...(state.settings.importMapping || {}), [headers.join('|')]: mapping };
    state.settings.importMapping = importMapping;
    api('/settings', { method: 'PUT', body: { importMapping } });

    ({ rows: preview } = await api('/import/preview', { method: 'POST', body: { rows } }));
    drawPreview();
  }

  function drawPreview() {
    const fresh = preview.filter(r => !r.duplicate);
    const dups = preview.length - fresh.length;
    const income = fresh.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0);
    const expenses = fresh.filter(r => r.amount < 0).reduce((a, r) => a - r.amount, 0);
    const uncategorized = fresh.filter(r => r.reason === 'fallback').length;
    const dates = preview.map(r => r.date).sort();
    const step3 = $('#step3');
    step3.style.display = '';
    step3.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">3 · Review categories</h2>
          <div class="row small">
            <span>${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])}</span>
            <span class="chip">${fresh.length} new</span>
            ${dups ? `<span class="chip warn">${dups} already imported</span>` : ''}
            ${uncategorized ? `<span class="chip bad">${uncategorized} need a category</span>` : ''}
            <span>In <strong class="pos">${money(income)}</strong></span><span>Out <strong class="neg">${money(expenses)}</strong></span>
          </div>
        </div>
        <p class="small subtle">Change any category below before importing — changes you make here are remembered for that merchant in future imports.</p>
        <div class="row" style="margin-bottom:10px"><label class="row small" style="gap:6px"><input type="checkbox" id="onlyUncat"> Show only uncategorized</label></div>
        <div class="table-wrap" style="max-height:60vh;overflow:auto"><table>
          <thead><tr><th>Date</th><th>Concept</th><th>Category</th><th class="num">Amount</th></tr></thead>
          <tbody id="pRows"></tbody>
        </table></div>
        <div class="row" style="margin-top:16px;justify-content:flex-end">
          <button id="cancelImport">Cancel</button>
          <button class="primary" id="commit" ${fresh.length ? '' : 'disabled'}>Import ${fresh.length} transactions</button>
        </div>
      </div>`;
    const drawRows = () => {
      const only = step3.querySelector('#onlyUncat').checked;
      step3.querySelector('#pRows').innerHTML = preview.map((r, i) => (only && r.reason !== 'fallback') ? '' : `
        <tr style="${r.duplicate ? 'opacity:.45' : ''}">
          <td style="white-space:nowrap">${esc(dateLabel(r.date))}</td>
          <td><div class="concept" title="${esc(r.concept)}">${esc(r.concept)}</div></td>
          <td>${r.duplicate ? '<span class="chip warn">already imported</span>' : `<div class="row" style="gap:4px;flex-wrap:nowrap">
            <select data-i="${i}">${categoryOptions(r.category_id)}</select>
            ${r.reason === 'learned' ? '<span class="chip small" title="Based on how you categorized this merchant before">learned</span>' : ''}
            ${r.reason === 'fallback' ? '<span class="chip bad small">?</span>' : ''}</div>`}</td>
          <td class="num ${r.amount > 0 ? 'pos' : ''}">${money(r.amount, { sign: true })}</td>
        </tr>`).join('');
    };
    drawRows();
    step3.querySelector('#onlyUncat').onchange = drawRows;
    step3.querySelector('#pRows').addEventListener('change', e => {
      const i = Number(e.target.dataset.i);
      const newCat = Number(e.target.value);
      const r = preview[i];
      r.category_id = newCat;
      r.reason = 'manual';
      // Apply the same choice to identical concepts further down so you only fix each merchant once.
      const key = r.concept.toUpperCase().replace(/[^A-Z]/g, '');
      let others = 0;
      preview.forEach((o, j) => {
        if (j !== i && !o.duplicate && o.reason !== 'manual' && o.concept.toUpperCase().replace(/[^A-Z]/g, '') === key) { o.category_id = newCat; o.reason = 'manual'; others++; }
      });
      if (others) { toast(`Also applied to ${others} identical transaction(s) in this file`); drawRows(); }
    });
    step3.querySelector('#cancelImport').onclick = () => importView(root);
    step3.querySelector('#commit').onclick = guard(async () => {
      let balanceAccountId = $('#balanceAccount').value;
      if (balanceAccountId === 'new') {
        const name = prompt('Name for the cash account (e.g. "Main bank account"):', 'Main bank account');
        if (!name) return;
        ({ id: balanceAccountId } = await api('/accounts', { method: 'POST', body: { name, type: 'cash' } }));
      }
      const res = await api('/import/commit', {
        method: 'POST',
        body: { filename, rows: preview, balanceAccountId: balanceAccountId ? Number(balanceAccountId) : null },
      });
      if (balanceAccountId) state.settings.balanceAccountId = Number(balanceAccountId);
      await loadCategories();
      toast(`Imported ${res.inserted} transactions${res.skipped ? ` · ${res.skipped} duplicates skipped` : ''}${res.balancesSet ? ` · balance updated for ${res.balancesSet} month(s)` : ''}`);
      location.hash = `#/transactions?month=${preview.map(r => r.date).sort().pop().slice(0, 7)}`;
    });
    step3.scrollIntoView({ behavior: 'smooth' });
  }
}
