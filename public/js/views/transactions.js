import { api, state, money, dateLabel, monthLabel, esc, toast, guard, modal, confirmDialog, formData, categoryOptions, loadCategories, today } from '../util.js';

export default async function transactions(root, params) {
  const months = await api('/transactions/months');
  const filters = {
    month: params.has('month') ? params.get('month') : (months[0] || ''),
    category_id: params.get('category_id') || '',
    type: params.get('type') || '',
    q: params.get('q') || '',
  };
  let rows = [];
  const selected = new Set();
  let applySimilar = true;

  root.innerHTML = `
    <div class="page-head"><h1>Transactions</h1><span class="spacer"></span>
      <button id="addTx">+ Add transaction</button>
      <a class="btn" href="#/import">Import statement</a>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="row">
        <select id="fMonth"><option value="">All months</option>${months.map(m => `<option value="${m}">${esc(monthLabel(m, 'long'))}</option>`).join('')}</select>
        <select id="fCat">${categoryOptions(filters.category_id, { includeEmpty: true })}</select>
        <select id="fType"><option value="">Income &amp; expenses</option><option value="expense">Expenses only</option><option value="income">Income only</option></select>
        <input id="fQ" type="search" placeholder="Search concept or notes…" style="flex:1;min-width:180px">
      </div>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <label class="row small subtle" style="gap:6px"><input type="checkbox" id="applySimilar" checked>
          When I change a category, also apply it to other transactions from the same merchant</label>
        <div id="summary" class="row small"></div>
      </div>
    </div>
    <div id="bulkBar" class="card row" style="display:none;margin-bottom:16px">
      <strong id="bulkCount"></strong>
      <select id="bulkCat">${categoryOptions(null)}</select>
      <button id="bulkApply" class="primary">Set category</button>
      <button id="bulkClear" class="link">Clear selection</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:30px"><input type="checkbox" id="selAll" aria-label="Select all"></th>
          <th>Date</th><th>Concept</th><th>Category</th><th class="num">Amount</th><th></th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;

  const $ = s => root.querySelector(s);
  $('#fMonth').value = filters.month;
  $('#fType').value = filters.type;
  $('#fQ').value = filters.q;

  const load = guard(async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    history.replaceState(null, '', `#/transactions?${qs.toString().replace(/^$/, 'month=')}`);
    rows = await api(`/transactions?${qs}`);
    selected.clear();
    draw();
  });

  function draw() {
    const income = rows.filter(r => r.amount > 0 && r.kind !== 'transfer').reduce((a, r) => a + r.amount, 0);
    const expenses = rows.filter(r => r.amount < 0 && r.kind !== 'transfer').reduce((a, r) => a - r.amount, 0);
    $('#summary').innerHTML = `<span class="muted">${rows.length} transactions</span>
      <span>In <strong class="pos">${money(income)}</strong></span>
      <span>Out <strong class="neg">${money(expenses)}</strong></span>`;
    $('#rows').innerHTML = rows.length ? rows.map(r => `
      <tr data-id="${r.id}">
        <td><input type="checkbox" class="sel" ${selected.has(r.id) ? 'checked' : ''} aria-label="Select"></td>
        <td style="white-space:nowrap">${esc(dateLabel(r.date))}</td>
        <td><div class="concept" title="${esc(r.concept)}">${esc(r.concept)}</div>
          ${r.notes ? `<div class="small muted">${esc(r.notes)}</div>` : ''}</td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap"><span class="dot" style="background:${r.color || '#bbb'}"></span>
          <select class="cat" aria-label="Category">${categoryOptions(r.category_id)}</select>
          ${r.manual ? '' : '<span class="chip small" title="Assigned automatically">auto</span>'}</div></td>
        <td class="num ${r.amount > 0 ? 'pos' : ''}">${money(r.amount, { sign: true })}</td>
        <td class="num"><button class="icon link" data-act="edit" title="Notes / rule">Edit</button>
          <button class="icon link danger" data-act="del" title="Delete">✕</button></td>
      </tr>`).join('') : `<tr><td colspan="6" class="empty">No transactions match these filters.</td></tr>`;
    $('#selAll').checked = rows.length > 0 && selected.size === rows.length;
    $('#bulkBar').style.display = selected.size ? 'flex' : 'none';
    $('#bulkCount').textContent = `${selected.size} selected`;
  }

  $('#fMonth').onchange = e => { filters.month = e.target.value; load(); };
  $('#fCat').onchange = e => { filters.category_id = e.target.value; load(); };
  $('#fType').onchange = e => { filters.type = e.target.value; load(); };
  let qTimer;
  $('#fQ').oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { filters.q = e.target.value; load(); }, 250); };
  $('#applySimilar').onchange = e => { applySimilar = e.target.checked; };

  $('#rows').addEventListener('change', guard(async e => {
    const tr = e.target.closest('tr');
    const id = Number(tr?.dataset.id);
    if (e.target.classList.contains('sel')) {
      e.target.checked ? selected.add(id) : selected.delete(id);
      return draw();
    }
    if (e.target.classList.contains('cat')) {
      const { similarUpdated } = await api(`/transactions/${id}`, { method: 'PATCH', body: { category_id: Number(e.target.value), applyToSimilar: applySimilar } });
      const cat = state.categories.find(c => c.id === Number(e.target.value));
      toast(similarUpdated ? `Updated this and ${similarUpdated} similar transaction(s) to ${cat.name}` : `Category set to ${cat.name}`);
      await loadCategories();
      load();
    }
  }));

  $('#rows').addEventListener('click', guard(async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const r = rows.find(x => x.id === Number(btn.closest('tr').dataset.id));
    if (btn.dataset.act === 'del') {
      if (await confirmDialog('Delete transaction', `Delete “${esc(r.concept)}” (${money(r.amount)})?`)) {
        await api(`/transactions/${r.id}`, { method: 'DELETE' });
        load();
      }
    } else editTx(r);
  }));

  $('#selAll').onchange = e => { rows.forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); draw(); };
  $('#bulkClear').onclick = () => { selected.clear(); draw(); };
  $('#bulkApply').onclick = guard(async () => {
    await api('/transactions/bulk', { method: 'POST', body: { ids: [...selected], category_id: Number($('#bulkCat').value) } });
    toast(`${selected.size} transactions updated`);
    load();
  });

  function editTx(r) {
    // Suggest the first meaningful word(s) of the concept as a rule keyword.
    const suggestion = r.concept.toUpperCase().replace(/\b(COMPRA|PAGO|TARJ\.?|TARJETA|RECIBO|EN|DE)\b/g, ' ').replace(/[0-9*X]{4,}/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
    modal({
      title: 'Edit transaction',
      body: `
        <p class="subtle" style="margin-top:0">${esc(dateLabel(r.date))} · <strong>${money(r.amount)}</strong><br>${esc(r.concept)}</p>
        <label class="field">Notes<input name="notes" value="${esc(r.notes || '')}"></label>
        <h3 style="margin-top:18px">Create a categorization rule</h3>
        <p class="small subtle" style="margin-top:0">Any transaction whose concept contains this keyword will be categorized automatically
          (existing auto-categorized transactions are updated too; your manual choices are kept).</p>
        <div class="form-grid">
          <label class="field">Keyword<input name="pattern" value="${esc(suggestion)}"></label>
          <label class="field">Category<select name="category_id">${categoryOptions(r.category_id)}</select></label>
        </div>
        <label class="row small" style="margin-top:8px;gap:6px"><input type="checkbox" name="makeRule"> Create this rule</label>`,
      onSubmit: async form => {
        const d = formData(form);
        await api(`/transactions/${r.id}`, { method: 'PATCH', body: { notes: d.notes } });
        if (d.makeRule) {
          if (Number(d.category_id) !== r.category_id) {
            await api(`/transactions/${r.id}`, { method: 'PATCH', body: { category_id: Number(d.category_id) } });
          }
          const { changed } = await api('/rules', { method: 'POST', body: { pattern: d.pattern, category_id: Number(d.category_id) } });
          toast(`Rule created · ${changed} transaction(s) re-categorized`);
        }
        load();
      },
    });
  }

  $('#addTx').onclick = () => modal({
    title: 'Add transaction',
    body: `<div class="form-grid">
      <label class="field">Date<input type="date" name="date" value="${today()}" required></label>
      <label class="field">Amount (negative = expense)<input type="number" step="0.01" name="amount" required placeholder="-25.00"></label>
      <label class="field wide">Concept<input name="concept" required></label>
      <label class="field">Category<select name="category_id"><option value="">Auto-detect</option>${categoryOptions(null)}</select></label>
      <label class="field">Notes<input name="notes"></label></div>`,
    submitLabel: 'Add',
    onSubmit: async form => {
      await api('/transactions', { method: 'POST', body: formData(form) });
      toast('Transaction added');
      load();
    },
  });

  load();
}
