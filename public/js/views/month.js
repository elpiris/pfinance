import { api, money, monthLabel, dateLabel, esc, currentMonth, chart, cssVar, legendHTML } from '../util.js';

// How far actual is from "typical by today", as a chip. For expenses, more is bad; for income, more is good.
function paceChip(actual, typical, kind) {
  const diff = actual - typical;
  const tolerance = Math.max(10, Math.abs(typical) * 0.1);
  if (Math.abs(diff) <= tolerance) return '<span class="chip">on track</span>';
  const good = kind === 'income' ? diff > 0 : diff < 0;
  const word = kind === 'income' ? (diff > 0 ? 'more' : 'less') : (diff > 0 ? 'above usual' : 'below usual');
  return `<span class="chip ${good ? 'good' : 'bad'}">${money(Math.abs(diff), { decimals: 0 })} ${word}</span>`;
}

export default async function month(root, params) {
  const months = await api('/transactions/months');
  const selected = params.get('month') || currentMonth();
  const options = [...new Set([currentMonth(), ...months])].sort().reverse();
  const f = await api(`/reports/forecast?month=${selected}`);

  const savings = {
    actual: f.income.actual - f.expenses.actual,
    expectedToDate: f.income.expectedToDate - f.expenses.expectedToDate,
    expected: f.income.expected - f.expenses.expected,
    projected: f.income.projected - f.expenses.projected,
  };
  const inProgress = f.asOfDay > 0 && f.asOfDay < f.daysInMonth;

  const kpi = (label, t, kind) => `
    <div class="card kpi">
      <div class="label">${label}</div>
      <div class="value">${money(t.actual, { decimals: 0 })}</div>
      <div class="delta muted">typical by day ${f.asOfDay}: ${money(t.expectedToDate, { decimals: 0 })}</div>
      <div style="margin-top:6px">${paceChip(t.actual, t.expectedToDate, kind)}</div>
      ${inProgress ? `<div class="delta" style="margin-top:8px">Projected month end: <strong>${money(t.projected, { decimals: 0 })}</strong>
        <span class="muted">(typical ${money(t.expected, { decimals: 0 })})</span></div>` : ''}
    </div>`;

  const income = f.categories.filter(c => c.kind === 'income').sort((a, b) => b.expected - a.expected);
  const groups = {};
  f.categories.filter(c => c.kind === 'expense').sort((a, b) => b.expected - a.expected)
    .forEach(c => (groups[c.group || 'Other'] ||= []).push(c));

  const catRow = c => {
    const ratio = c.expected > 0 ? Math.min(100, (c.actual / c.expected) * 100) : 0;
    const over = c.kind === 'expense' && c.actual > c.expected && c.expected > 0;
    return `<tr>
      <td><a class="row" style="gap:0;color:inherit;text-decoration:none" href="#/transactions?month=${f.month}&category_id=${c.id ?? ''}">
        <span class="dot" style="background:${c.color}"></span>${esc(c.name)}</a></td>
      <td class="num"><strong>${money(c.actual)}</strong></td>
      <td class="num muted">${money(c.expectedToDate)}</td>
      <td>${paceChip(c.actual, c.expectedToDate, c.kind)}</td>
      <td style="min-width:120px"><div class="bar-track"><div class="bar-fill ${over ? 'over' : ''}" style="width:${ratio}%"></div></div>
        <div class="small muted">${Math.round(c.expected ? (c.actual / c.expected) * 100 : 0)}% of ${money(c.expected, { decimals: 0 })}</div></td>
      ${inProgress ? `<td class="num">${money(c.projected, { decimals: 0 })}</td>` : ''}
    </tr>`;
  };
  const head = `<tr><th>Category</th><th class="num">So far</th><th class="num">Typical by day ${f.asOfDay}</th><th>Pace</th><th>Of a typical month</th>
    ${inProgress ? '<th class="num">Projected</th>' : ''}</tr>`;
  const cols = inProgress ? 6 : 5;

  root.innerHTML = `
    <div class="page-head"><h1>${esc(monthLabel(f.month, 'long'))}</h1><span class="spacer"></span>
      <select id="month">${options.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${esc(monthLabel(m, 'long'))}</option>`).join('')}</select>
    </div>
    ${f.historyMonths === 0 ? `<div class="card empty">There's no history before this month yet. Import a few previous months to get expectations.</div>` : `
    ${inProgress && f.dataUntil && f.dataUntil.slice(0, 7) === f.month && f.dataUntil < new Date().toISOString().slice(0, 10)
      ? `<div class="card row" style="margin-bottom:16px;background:var(--warning-bg);border-color:transparent">
          <span>Your imported statements go up to <strong>${esc(dateLabel(f.dataUntil))}</strong>, so this page compares up to that day.
          <a href="#/import" style="color:var(--accent)">Import a newer statement</a> to update it.</span></div>` : ''}
    ${f.asOfDay === 0 && f.dataUntil && f.dataUntil < `${f.month}-01` ? `<div class="card row" style="margin-bottom:16px;background:var(--warning-bg);border-color:transparent">
          <span>No transactions imported for this month yet (latest: ${esc(dateLabel(f.dataUntil))}). <a href="#/import" style="color:var(--accent)">Import a statement</a>.</span></div>` : ''}
    <p class="subtle" style="margin-top:-10px">${f.asOfDay === 0 ? 'No data for this month yet.' : inProgress
      ? `Day ${f.asOfDay} of ${f.daysInMonth}. “Typical” is the average of the last ${f.historyMonths} month(s) <em>up to the same day</em>, so income and bills that usually arrive late in the month aren’t counted as missing yet.`
      : `Complete month, compared with the average of the ${f.historyMonths} month(s) before it.`}</p>
    <div class="grid kpis">
      ${kpi('Income', f.income, 'income')}
      ${kpi('Expenses', f.expenses, 'expense')}
      <div class="card kpi">
        <div class="label">${inProgress ? 'Projected savings' : 'Saved'}</div>
        <div class="value ${(inProgress ? savings.projected : savings.actual) < 0 ? 'neg' : ''}">${money(inProgress ? savings.projected : savings.actual, { decimals: 0 })}</div>
        <div class="delta muted">typical month: ${money(savings.expected, { decimals: 0 })}</div>
        <div style="margin-top:6px">${paceChip(inProgress ? savings.projected : savings.actual, savings.expected, 'income')}</div>
        ${inProgress ? `<div class="delta muted" style="margin-top:8px">So far: ${money(savings.actual, { decimals: 0 })}</div>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Spending through the month</h2>
      ${legendHTML([['This month', cssVar('--series-1')], ['Typical month', cssVar('--text-muted')]])}
      <div class="chart-box"><canvas id="cumChart"></canvas></div>
    </div>

    <div class="card" style="margin-top:16px;padding:0">
      <div class="table-wrap"><table>
        <thead>${head}</thead>
        <tbody>
          ${income.length ? `<tr><td colspan="${cols}" class="small subtle" style="background:var(--surface-2);font-weight:600">Income</td></tr>${income.map(catRow).join('')}` : ''}
          ${Object.entries(groups).map(([g, list]) => `<tr><td colspan="${cols}" class="small subtle" style="background:var(--surface-2);font-weight:600">${esc(g)}</td></tr>${list.map(catRow).join('')}`).join('')}
        </tbody>
      </table></div>
    </div>`}`;

  root.querySelector('#month').onchange = e => { location.hash = `#/month?month=${e.target.value}`; };
  if (!f.historyMonths) return;

  const days = Array.from({ length: f.daysInMonth }, (_, i) => i + 1);
  const actualColor = cssVar('--series-1');
  const typicalColor = cssVar('--text-muted');
  chart(root.querySelector('#cumChart'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: 'This month', data: f.cumulative.actual, borderColor: actualColor, backgroundColor: actualColor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.15 },
        { label: 'Typical month', data: f.cumulative.expected, borderColor: typicalColor, backgroundColor: typicalColor, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 5, tension: 0.15 },
      ],
    },
    options: {
      scales: { x: { title: { display: true, text: 'Day of month' } } },
      plugins: { tooltip: { callbacks: { title: items => `Day ${items[0].label}` } } },
    },
  });
}
