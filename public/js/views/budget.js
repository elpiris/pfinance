import { api, state, money, monthLabel, dateLabel, esc, toast, guard, currentMonth, addMonths, loadCategories, cssVar } from '../util.js';

export default async function budget(root, params) {
  const months = await api('/transactions/months');
  const month = params.get('month') || months[0] || currentMonth();
  const [rows, trend, recurring] = await Promise.all([
    api(`/reports/budget?month=${month}`),
    api(`/reports/category-trend?to=${month}&from=${addMonths(month, -11)}`),
    api('/reports/recurring'),
  ]);

  const budgeted = rows.filter(r => r.budget);
  const totalBudget = budgeted.reduce((a, r) => a + r.budget, 0);
  const totalSpent = rows.reduce((a, r) => a + Math.max(0, r.spent), 0);
  const totalAvg = rows.reduce((a, r) => a + Math.max(0, r.avg6), 0);
  const recurringTotal = recurring.reduce((a, r) => a + r.monthly, 0);

  // Biggest increases vs the trailing average: where to look for savings first.
  const overAvg = rows.filter(r => r.avg6 > 0 && r.spent > r.avg6 * 1.15 && r.spent - r.avg6 > 20)
    .sort((a, b) => (b.spent - b.avg6) - (a.spent - a.avg6)).slice(0, 5);

  const groups = {};
  rows.forEach(r => (groups[r.group || 'Other'] ||= []).push(r));

  const statusOf = r => {
    if (!r.budget) return '';
    const ratio = r.spent / r.budget;
    return ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : '';
  };

  root.innerHTML = `
    <div class="page-head"><h1>Spending &amp; budget</h1><span class="spacer"></span>
      <select id="month">${(months.length ? months : [month]).map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m, 'long'))}</option>`).join('')}</select>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Spent in ${esc(monthLabel(month, 'long'))}</div><div class="value">${money(totalSpent, { decimals: 0 })}</div>
        <div class="delta ${totalSpent <= totalAvg ? 'pos' : 'neg'}">${money(totalSpent - totalAvg, { sign: true, decimals: 0 })} vs 6-month average</div></div>
      <div class="card kpi"><div class="label">Budgeted categories</div><div class="value">${money(budgeted.reduce((a, r) => a + Math.max(0, r.spent), 0), { decimals: 0 })} <span class="muted" style="font-size:15px">/ ${money(totalBudget, { decimals: 0 })}</span></div>
        <div class="delta muted">${budgeted.length} categories with a budget</div></div>
      <div class="card kpi"><div class="label">Recurring charges</div><div class="value">${money(recurringTotal, { decimals: 0 })}<span class="muted" style="font-size:15px">/mo</span></div>
        <div class="delta muted">${money(recurringTotal * 12, { decimals: 0 })} per year</div></div>
    </div>

    ${overAvg.length ? `<div class="card" style="margin-top:16px">
      <h2>Where you spent more than usual</h2>
      <div class="row">${overAvg.map(r => `<a class="chip warn" style="text-decoration:none" href="#/transactions?month=${month}&category_id=${r.id}">
        ${esc(r.name)}: ${money(r.spent, { decimals: 0 })} (avg ${money(r.avg6, { decimals: 0 })}, ${money(r.spent - r.avg6, { sign: true, decimals: 0 })})</a>`).join('')}</div>
    </div>` : ''}

    <div class="card" style="margin-top:16px;padding:0">
      <div style="padding:18px 18px 0"><h2>Budget by category</h2>
        <p class="small subtle" style="margin-top:-6px">Click a budget cell to set a monthly limit. Average = last 6 months with data.</p></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Category</th><th class="num">Spent</th><th style="width:28%">Progress</th><th class="num">Budget</th><th class="num">6-mo avg</th><th class="num">vs avg</th></tr></thead>
        <tbody>${Object.entries(groups).map(([g, list]) => `
          <tr><td colspan="6" class="small subtle" style="background:var(--surface-2);font-weight:600">${esc(g)}</td></tr>
          ${list.map(r => {
            const st = statusOf(r);
            const width = r.budget ? Math.min(100, (r.spent / r.budget) * 100) : 0;
            const diff = r.spent - r.avg6;
            return `<tr>
              <td><a href="#/transactions?month=${month}&category_id=${r.id}" style="color:inherit;text-decoration:none" class="row"><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</a></td>
              <td class="num">${money(r.spent)}</td>
              <td>${r.budget ? `<div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar-track" style="flex:1"><div class="bar-fill ${st}" style="width:${width}%"></div></div>
                <span class="small ${st === 'over' ? 'neg' : 'muted'}" style="width:42px;text-align:right">${Math.round((r.spent / r.budget) * 100)}%</span></div>` : '<span class="muted small">—</span>'}</td>
              <td class="num"><input class="budget" data-id="${r.id}" type="number" step="10" min="0" value="${r.budget ?? ''}" placeholder="set" style="width:90px;text-align:right"></td>
              <td class="num muted">${money(r.avg6)}</td>
              <td class="num ${r.avg6 ? (diff > 0 ? 'neg' : 'pos') : 'muted'}">${r.avg6 ? money(diff, { sign: true, decimals: 0 }) : '—'}</td>
            </tr>`;
          }).join('')}`).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="card" style="margin-top:16px;padding:0">
      <div style="padding:18px 18px 0"><h2>Spending by category · last 12 months</h2>
        <p class="small subtle" style="margin-top:-6px">Darker = more spent in that category (shaded relative to each category’s own peak).</p></div>
      <div class="table-wrap" id="heat"></div>
    </div>

    <div class="card" style="margin-top:16px;padding:0">
      <div style="padding:18px 18px 0"><h2>Recurring charges &amp; subscriptions</h2>
        <p class="small subtle" style="margin-top:-6px">Merchants charging you a similar amount in at least 3 of the last 6 months. Good candidates to review or cancel.</p></div>
      ${recurring.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Merchant</th><th>Category</th><th class="num">Charges</th><th class="num">Per month</th><th class="num">Per year</th><th>Last charge</th></tr></thead>
        <tbody>${recurring.map(r => `<tr>
          <td><div class="concept">${esc(r.concept)}</div></td>
          <td style="white-space:nowrap"><span class="dot" style="background:${r.color || '#bbb'}"></span>${esc(r.category_name || '—')}</td>
          <td class="num">${r.occurrences}</td><td class="num">${money(r.monthly)}</td><td class="num">${money(r.monthly * 12, { decimals: 0 })}</td>
          <td style="white-space:nowrap">${esc(dateLabel(r.last))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Not enough history yet — import at least 3 months of statements.</div>'}
    </div>`;

  root.querySelector('#month').onchange = e => { location.hash = `#/budget?month=${e.target.value}`; };
  root.querySelectorAll('input.budget').forEach(inp => inp.onchange = guard(async () => {
    const cat = state.categories.find(c => c.id === Number(inp.dataset.id));
    await api(`/categories/${cat.id}`, { method: 'PUT', body: { ...cat, budget: inp.value === '' ? null : Number(inp.value) } });
    await loadCategories();
    toast(`Budget for ${cat.name} saved`);
    budget(root, params);
  }));

  // Heatmap: per-row sequential shading so small categories are still readable.
  const seq = [1, 2, 3, 4, 5, 6].map(i => cssVar(`--seq-${i}`));
  const cats = trend.categories
    .map(c => ({ ...c, total: Object.values(c.values).reduce((a, b) => a + b, 0) }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const activeMonths = trend.months.filter(m => cats.some(c => c.values[m] > 0)).length || 1;
  const inkOn = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? '#ffffff' : '#0b0b0b';
  };
  root.querySelector('#heat').innerHTML = cats.length ? `<table class="heat">
    <thead><tr><th>Category</th>${trend.months.map(m => `<th class="num">${esc(monthLabel(m))}</th>`).join('')}<th class="num">Avg/mo</th></tr></thead>
    <tbody>${cats.map(c => {
      const max = Math.max(...Object.values(c.values));
      return `<tr><td style="white-space:nowrap"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</td>
        ${trend.months.map(m => {
          const v = c.values[m];
          if (v <= 0) return `<td class="cell muted" title="${esc(c.name)} · ${esc(monthLabel(m, 'long'))}: ${money(0)}">·</td>`;
          const step = Math.min(5, Math.floor((v / max) * 6));
          return `<td class="cell" style="background:${seq[step]};color:${inkOn(seq[step])}" title="${esc(c.name)} · ${esc(monthLabel(m, 'long'))}: ${money(v)}">${money(v, { decimals: 0 })}</td>`;
        }).join('')}
        <td class="num"><strong>${money(c.total / activeMonths, { decimals: 0 })}</strong></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No expense data yet.</div>';
}
