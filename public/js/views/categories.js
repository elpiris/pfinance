import { api, state, esc, toast, guard, modal, confirmDialog, formData, categoryOptions, loadCategories, money } from '../util.js';

const KINDS = { expense: 'Expense', income: 'Income', transfer: 'Transfer (excluded from totals)' };

export default async function categories(root) {
  const [cats, rules] = await Promise.all([loadCategories(), api('/rules')]);
  const userRules = rules.filter(r => r.source === 'user');
  const defaultRules = rules.filter(r => r.source !== 'user');

  root.innerHTML = `
    <div class="page-head"><h1>Categories &amp; rules</h1><span class="spacer"></span>
      <button id="reapply">Re-run auto-categorization</button>
      <button class="primary" id="addCat">+ Add category</button></div>
    <div class="grid cols-2">
      <div class="card" style="padding:0">
        <div style="padding:18px 18px 0"><h2>Categories</h2>
          <p class="small subtle" style="margin-top:-6px"><em>Transfer</em> categories (moving money between your own accounts, investing)
            are excluded from income/expense totals so they don’t look like spending.</p></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Type</th><th>Group</th><th class="num">Budget</th><th class="num">Transactions</th><th></th></tr></thead>
          <tbody>${cats.map(c => `<tr>
            <td><span class="row" style="gap:0"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span></td>
            <td class="subtle">${esc(KINDS[c.kind])}</td><td class="subtle">${esc(c.group || '')}</td>
            <td class="num">${c.budget ? money(c.budget, { decimals: 0 }) : '—'}</td>
            <td class="num"><a href="#/transactions?month=&category_id=${c.id}" style="color:var(--accent)">${c.tx_count}</a></td>
            <td class="num"><button class="link" data-edit="${c.id}">Edit</button></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="stack">
        <div class="card">
          <h2>Your rules</h2>
          <p class="small subtle" style="margin-top:-6px">If a transaction’s concept contains the keyword, it gets that category.
            Your rules take priority over built-in ones. Categories you set by hand are never overwritten.</p>
          <form id="ruleForm" class="row" style="margin-bottom:12px">
            <input name="pattern" placeholder="Keyword, e.g. GYM CENTER" required style="flex:1;min-width:140px">
            <select name="category_id">${categoryOptions(null)}</select>
            <button class="primary">Add rule</button>
          </form>
          ${userRules.length ? `<div class="table-wrap"><table class="small"><tbody>${userRules.map(ruleRow).join('')}</tbody></table></div>`
            : '<div class="muted small">No custom rules yet. You can also create one from any transaction via “Edit”.</div>'}
        </div>
        <div class="card">
          <details><summary style="cursor:pointer;font-weight:600">Built-in rules (${defaultRules.length})</summary>
            <input id="ruleSearch" type="search" placeholder="Filter…" style="margin:12px 0;width:100%">
            <div class="table-wrap" style="max-height:420px"><table class="small"><tbody id="defRules">${defaultRules.map(ruleRow).join('')}</tbody></table></div>
          </details>
        </div>
      </div>
    </div>`;

  function ruleRow(r) {
    return `<tr data-rule="${esc(r.pattern)} ${esc(r.category_name)}"><td><code>${esc(r.pattern)}</code></td>
      <td><span class="row" style="gap:0"><span class="dot" style="background:${r.color}"></span>${esc(r.category_name)}</span></td>
      <td class="num"><button class="link danger" data-del-rule="${r.id}" title="Delete rule">✕</button></td></tr>`;
  }

  const $ = s => root.querySelector(s);
  $('#ruleSearch').oninput = e => {
    const q = e.target.value.toUpperCase();
    root.querySelectorAll('#defRules tr').forEach(tr => { tr.style.display = tr.dataset.rule.toUpperCase().includes(q) ? '' : 'none'; });
  };

  $('#ruleForm').onsubmit = guard(async e => {
    e.preventDefault();
    const d = formData(e.target);
    const { changed } = await api('/rules', { method: 'POST', body: { pattern: d.pattern, category_id: Number(d.category_id) } });
    toast(`Rule added · ${changed} transaction(s) re-categorized`);
    categories(root);
  });

  root.querySelectorAll('[data-del-rule]').forEach(b => b.onclick = guard(async () => {
    const { changed } = await api(`/rules/${b.dataset.delRule}`, { method: 'DELETE' });
    toast(`Rule deleted${changed ? ` · ${changed} transaction(s) re-categorized` : ''}`);
    categories(root);
  }));

  $('#reapply').onclick = guard(async () => {
    const { changed } = await api('/rules/reapply', { method: 'POST' });
    toast(`${changed} transaction(s) re-categorized`);
    categories(root);
  });

  const form = (c = {}) => `<div class="form-grid">
    <label class="field">Name<input name="name" required value="${esc(c.name || '')}"></label>
    <label class="field">Type<select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Group<input name="group" value="${esc(c.group || '')}" list="groups" placeholder="e.g. Bills, Lifestyle"></label>
    <label class="field">Monthly budget<input type="number" step="10" min="0" name="budget" value="${c.budget ?? ''}"></label>
    <label class="field">Color<input type="color" name="color" value="${c.color || '#2a78d6'}"></label>
    <datalist id="groups">${[...new Set(state.categories.map(x => x.group).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
  </div>`;

  $('#addCat').onclick = () => modal({
    title: 'Add category', body: form({ kind: 'expense' }), submitLabel: 'Add',
    onSubmit: async f => { await api('/categories', { method: 'POST', body: formData(f) }); categories(root); },
  });

  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const c = cats.find(x => x.id === Number(b.dataset.edit));
    const { close } = modal({
      title: `Edit ${c.name}`, body: form(c),
      extraButtons: c.name === 'Uncategorized' ? '' : '<button type="button" class="danger" data-del>Delete</button>',
      onSubmit: async f => { await api(`/categories/${c.id}`, { method: 'PUT', body: formData(f) }); categories(root); },
    });
    document.querySelector('dialog [data-del]')?.addEventListener('click', guard(async () => {
      close();
      if (await confirmDialog('Delete category', `Delete “${esc(c.name)}”? Its ${c.tx_count} transaction(s) become Uncategorized and its rules are removed.`)) {
        await api(`/categories/${c.id}`, { method: 'DELETE' });
        categories(root);
      }
    }));
  });
}
