import { api, state, money, pct, monthLabel, chart, cssVar, legendHTML, esc, addMonths } from '../util.js';

export default async function dashboard(root) {
  const [networth, monthly, months, forecast] = await Promise.all([
    api('/reports/networth'),
    api('/reports/monthly'),
    api('/transactions/months'),
    api('/reports/forecast'),
  ]);

  if (!networth.length && !months.length) {
    root.innerHTML = `
      <div class="page-head"><h1>Dashboard</h1></div>
      <div class="card empty">
        <h2>Welcome to PFinance</h2>
        <p>Start by <a href="#/import">importing a bank statement</a>, adding your <a href="#/investments">investment accounts</a>,
        or your <a href="#/properties">real estate</a>.</p>
      </div>`;
    return;
  }

  // Most recent month that has transactions drives the spending section.
  const focusMonth = months[0];
  const [cats, trend] = await Promise.all([
    focusMonth ? api(`/reports/categories?from=${focusMonth}&to=${focusMonth}`) : [],
    focusMonth ? api(`/reports/monthly?from=${addMonths(focusMonth, -5)}&to=${addMonths(focusMonth, -1)}`) : [],
  ]);

  // Compare the latest month you actually recorded values for (later months just carry values forward).
  let li = networth.length - 1;
  while (li > 0 && !networth[li].hasData) li--;
  const last = networth[li] || {};
  const vehicleNet = d => (d.vehicles || 0) - (d.vehicleLoans || 0);
  const hasVehicles = networth.some(d => d.vehicles || d.vehicleLoans);
  const focus = monthly.find(m => m.month === focusMonth) || { income: 0, expenses: 0, net: 0 };
  const avgExpenses = trend.length ? trend.reduce((a, m) => a + m.expenses, 0) / trend.filter(m => m.expenses > 0).length || 0 : 0;

  // Real change = difference minus whatever started being tracked in between (a newly added account isn't growth).
  const newlyTrackedSince = fromIndex => networth.slice(fromIndex + 1, li + 1).reduce((a, d) => a + (d.newlyTracked || 0), 0);
  const delta = (fromIndex, label) => {
    const then = networth[fromIndex];
    if (fromIndex < 0 || !then) return '';
    const added = newlyTrackedSince(fromIndex);
    const d = last.netWorth - then.netWorth - added;
    return `<div class="delta ${d >= 0 ? 'pos' : 'neg'}">${money(d, { sign: true, decimals: 0 })} ${label}</div>
      ${Math.abs(added) >= 1 ? `<div class="delta muted small" title="Accounts, properties or vehicles whose first value was recorded in this period">excl. ${money(added, { decimals: 0 })} newly tracked</div>` : ''}`;
  };

  const expenseCats = cats.filter(c => c.kind === 'expense' && c.total < 0).sort((a, b) => a.total - b.total);
  const maxCat = expenseCats.length ? -expenseCats[0].total : 1;

  root.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><span class="spacer"></span>
      <a class="btn" href="#/import">Import statement</a>
      <a class="btn" href="#/investments">Update investments</a>
    </div>

    <div class="grid kpis">
      <div class="card kpi">
        <div class="label">Net worth</div>
        <div class="value">${money(last.netWorth, { decimals: 0 })}</div>
        ${last.month ? `<div class="delta muted">as of ${esc(monthLabel(last.month, 'long'))}</div>` : ''}
        ${delta(li - 1, 'vs last month')}
        ${delta(li - 12, 'vs 12 months ago')}
      </div>
      <div class="card kpi">
        <div class="label">Cash &amp; savings</div>
        <div class="value">${money(last.cash, { decimals: 0 })}</div>
      </div>
      <div class="card kpi">
        <div class="label">Investments</div>
        <div class="value">${money(last.investments, { decimals: 0 })}</div>
      </div>
      <div class="card kpi">
        <div class="label">Real estate equity</div>
        <div class="value">${money((last.realEstate || 0) - (last.mortgage || 0), { decimals: 0 })}</div>
        ${last.mortgage ? `<div class="delta muted">${money(last.realEstate, { decimals: 0 })} value − ${money(last.mortgage, { decimals: 0 })} mortgage</div>` : ''}
      </div>
      ${hasVehicles ? `<div class="card kpi">
        <div class="label">Vehicles</div>
        <div class="value ${vehicleNet(last) < 0 ? 'neg' : ''}">${money(vehicleNet(last), { decimals: 0 })}</div>
        <div class="delta muted">${state.settings.includeVehicleValue === false
          ? `${money(last.vehicleLoans, { decimals: 0 })} car loan (resale value not counted)`
          : `${money(last.vehicles, { decimals: 0 })} value − ${money(last.vehicleLoans, { decimals: 0 })} loan`}</div>
      </div>` : ''}
    </div>

    ${forecast.historyMonths && forecast.asOfDay ? (() => {
      const f = forecast;
      const spendDiff = f.expenses.actual - f.expenses.expectedToDate;
      const projSavings = f.income.projected - f.expenses.projected;
      return `<a class="card row" href="#/month" style="margin-top:16px;text-decoration:none;color:inherit;justify-content:space-between">
        <div><h2 style="margin:0">${esc(monthLabel(f.month, 'long'))} so far</h2>
          <div class="small muted">Data up to day ${f.asOfDay} of ${f.daysInMonth}, compared with a typical month up to that day</div></div>
        <div class="row" style="gap:28px">
          <div class="kpi"><div class="label">Spent</div><div class="value" style="font-size:20px">${money(f.expenses.actual, { decimals: 0 })}</div>
            <div class="delta ${spendDiff <= 0 ? 'pos' : 'neg'}">${money(spendDiff, { sign: true, decimals: 0 })} vs typical</div></div>
          <div class="kpi"><div class="label">Received</div><div class="value" style="font-size:20px">${money(f.income.actual, { decimals: 0 })}</div>
            <div class="delta muted">typical ${money(f.income.expectedToDate, { decimals: 0 })}</div></div>
          <div class="kpi"><div class="label">Projected savings</div><div class="value" style="font-size:20px">${money(projSavings, { decimals: 0 })}</div>
            <div class="delta muted">typical ${money(f.income.expected - f.expenses.expected, { decimals: 0 })}</div></div>
          <span style="color:var(--accent)">Details →</span>
        </div></a>`;
    })() : ''}

    <div class="card" style="margin-top:16px">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Net worth over time</h2>
        <div class="tabs" id="nwRange">
          <button data-n="12">1Y</button><button data-n="36">3Y</button><button data-n="0" class="active">All</button>
        </div>
      </div>
      <div style="margin-top:10px">${legendHTML([['Cash & savings', cssVar('--series-1')], ['Investments', cssVar('--series-2')], ['Real estate equity', cssVar('--series-3')],
        ...(hasVehicles ? [['Vehicles (value − loan)', cssVar('--series-4')]] : [])])}</div>
      <div class="chart-box tall"><canvas id="nwChart"></canvas></div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Income vs expenses · last 12 months</h2>
        ${legendHTML([['Income', cssVar('--series-1')], ['Expenses', cssVar('--series-2')]])}
        <div class="chart-box"><canvas id="ieChart"></canvas></div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:12px">
          <h2 style="margin:0">${focusMonth ? esc(monthLabel(focusMonth, 'long')) : 'This month'}</h2>
          ${focusMonth ? `<a class="small" style="color:var(--accent)" href="#/transactions?month=${focusMonth}">View transactions →</a>` : ''}
        </div>
        <div class="grid cols-3" style="gap:10px;margin-bottom:16px">
          <div class="kpi"><div class="label">Income</div><div class="value" style="font-size:20px">${money(focus.income, { decimals: 0 })}</div></div>
          <div class="kpi"><div class="label">Expenses</div><div class="value" style="font-size:20px">${money(focus.expenses, { decimals: 0 })}</div>
            ${avgExpenses ? `<div class="delta ${focus.expenses <= avgExpenses ? 'pos' : 'neg'}">${money(focus.expenses - avgExpenses, { sign: true, decimals: 0 })} vs 5-mo avg</div>` : ''}</div>
          <div class="kpi"><div class="label">Saved</div><div class="value" style="font-size:20px">${money(focus.net, { decimals: 0 })}</div>
            <div class="delta muted">${pct(focus.savingsRate)} savings rate</div></div>
        </div>
        <h3>Top spending categories</h3>
        <div class="stack" style="gap:9px">
          ${expenseCats.slice(0, 8).map(c => `
            <a href="#/transactions?month=${focusMonth}&category_id=${c.id ?? ''}" style="color:inherit;text-decoration:none">
              <div class="row" style="justify-content:space-between;gap:6px;margin-bottom:3px">
                <span class="row" style="gap:0"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>
                <span class="num">${money(-c.total)}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:${(-c.total / maxCat) * 100}%"></div></div>
            </a>`).join('') || '<div class="muted">No expenses this month.</div>'}
        </div>
      </div>
    </div>`;

  // Net worth: stacked components that sum to net worth; the tooltip footer shows the total.
  const nwCanvas = root.querySelector('#nwChart');
  let nwChart;
  const drawNetWorth = n => {
    nwChart?.destroy();
    const data = n ? networth.slice(-n) : networth;
    const surface = cssVar('--surface-1');
    // Each band fills down to the previous series' line, so the top line is always total net worth.
    // A negative band (car loan bigger than the car's value) is drawn below the line before it.
    const ds = (label, key, color, fn, fill = '-1') => ({
      label, data: data.map(fn || (d => d[key])), borderColor: color, backgroundColor: color + 'cc',
      fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0.25,
    });
    nwChart = chart(nwCanvas, {
      type: 'line',
      data: {
        labels: data.map(d => monthLabel(d.month)),
        datasets: [
          ds('Cash & savings', 'cash', cssVar('--series-1'), null, 'origin'),
          ds('Investments', 'investments', cssVar('--series-2')),
          ds('Real estate equity', null, cssVar('--series-3'), d => d.realEstate - d.mortgage),
          ...(hasVehicles ? [ds('Vehicles (value − loan)', null, cssVar('--series-4'), vehicleNet)] : []),
        ],
      },
      options: {
        scales: { y: { stacked: true } },
        plugins: { tooltip: { callbacks: { footer: items => {
          const d = data[items[0].dataIndex];
          const lines = [`Net worth: ${money(d.netWorth)}`];
          if (Math.abs(d.newlyTracked) >= 1) lines.push(`Includes ${money(d.newlyTracked, { decimals: 0 })} newly tracked this month`);
          return lines;
        } } } },
      },
    });
  };
  drawNetWorth(0);
  root.querySelector('#nwRange').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    root.querySelectorAll('#nwRange button').forEach(x => x.classList.toggle('active', x === b));
    drawNetWorth(Number(b.dataset.n));
  });

  chart(root.querySelector('#ieChart'), {
    type: 'bar',
    data: {
      labels: monthly.map(m => monthLabel(m.month)),
      datasets: [
        { label: 'Income', data: monthly.map(m => m.income), backgroundColor: cssVar('--series-1'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 },
        { label: 'Expenses', data: monthly.map(m => m.expenses), backgroundColor: cssVar('--series-2'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.7, barPercentage: 0.9 },
      ],
    },
    options: {
      plugins: { tooltip: { callbacks: { footer: items => {
        const m = monthly[items[0].dataIndex];
        return `Saved: ${money(m.net)} (${pct(m.savingsRate)})`;
      } } } },
    },
  });
}
