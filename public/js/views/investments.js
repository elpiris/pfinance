import { api, money, monthLabel, esc, toast, guard, modal, confirmDialog, formData, currentMonth, chart, cssVar, pct } from '../util.js';

const TYPES = { cash: 'Cash / current account', savings: 'Savings / deposit', brokerage: 'Brokerage / funds', pension: 'Pension plan', crypto: 'Crypto', other: 'Other' };

export default async function investments(root, params) {
  const month = params.get('month') || currentMonth();
  const [accounts, grid] = await Promise.all([api('/accounts'), api(`/snapshots?month=${month}`)]);

  root.innerHTML = `
    <div class="page-head"><h1>Investments &amp; accounts</h1><span class="spacer"></span>
      <button id="addAcc">+ Add account</button></div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Monthly update</h2>
        <div class="row"><label class="row small">Month <input type="month" id="month" value="${month}"></label></div>
      </div>
      ${grid.length ? `
      <p class="small subtle">Enter each account’s value at the end of the month. <em>Net contribution</em> is the money you added
        (negative if you withdrew) so growth isn’t confused with deposits. Leave a value empty to skip that account.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Account</th><th>Type</th><th class="num">Previous</th><th class="num">Value at month end</th><th class="num">Net contribution</th><th class="num">Market change</th></tr></thead>
        <tbody>${grid.map(g => `<tr data-id="${g.account_id}" data-prev="${g.prev_value ?? ''}">
          <td><strong>${esc(g.name)}</strong></td>
          <td class="subtle">${esc(TYPES[g.type] || g.type)}</td>
          <td class="num muted">${g.prev_value !== null ? `${money(g.prev_value)}<div class="small">${esc(monthLabel(g.prev_month))}</div>` : '—'}</td>
          <td class="num"><input type="number" step="0.01" class="val" value="${g.value ?? ''}" placeholder="${g.prev_value ?? ''}" style="width:140px;text-align:right"></td>
          <td class="num"><input type="number" step="0.01" class="contrib" value="${g.contributions || ''}" placeholder="0" style="width:110px;text-align:right"></td>
          <td class="num change">—</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button id="copyPrev">Copy previous values</button>
        <button class="primary" id="saveGrid">Save ${esc(monthLabel(month, 'long'))}</button>
      </div>` : `<div class="empty">Add your first account (brokerage, pension plan, savings, crypto…) to start tracking its value.</div>`}
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card" style="padding:0">
        <div style="padding:18px 18px 0"><h2>Accounts</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Account</th><th class="num">Latest value</th><th class="num">Contributed</th><th></th></tr></thead>
          <tbody>${accounts.map(a => `<tr data-acc="${a.id}" style="cursor:pointer;${a.active ? '' : 'opacity:.5'}">
            <td><strong>${esc(a.name)}</strong><div class="small muted">${esc(TYPES[a.type] || a.type)}${a.active ? '' : ' · archived'}${a.latest_month ? ` · ${esc(monthLabel(a.latest_month))}` : ''}</div></td>
            <td class="num">${money(a.latest_value)}</td>
            <td class="num muted">${a.total_contributions ? money(a.total_contributions) : '—'}</td>
            <td class="num"><button class="link" data-edit="${a.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No accounts yet.</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h2 id="histTitle">All accounts · total value</h2>
        <div class="chart-box"><canvas id="histChart"></canvas></div>
        <div id="histTable" style="margin-top:12px"></div>
      </div>
    </div>`;

  const $ = s => root.querySelector(s);
  $('#month').onchange = e => { if (e.target.value) location.hash = `#/investments?month=${e.target.value}`; };

  const updateChanges = () => root.querySelectorAll('tr[data-id]').forEach(tr => {
    const prev = tr.dataset.prev === '' ? null : Number(tr.dataset.prev);
    const v = tr.querySelector('.val').value;
    const c = Number(tr.querySelector('.contrib').value || 0);
    const cell = tr.querySelector('.change');
    if (v === '' || prev === null) { cell.textContent = '—'; cell.className = 'num change muted'; return; }
    const change = Number(v) - prev - c;
    cell.innerHTML = `${money(change, { sign: true })}<div class="small">${prev ? pct(change / prev, 1) : ''}</div>`;
    cell.className = `num change ${change >= 0 ? 'pos' : 'neg'}`;
  });
  root.querySelectorAll('.val, .contrib').forEach(i => i.oninput = updateChanges);
  updateChanges();

  $('#copyPrev')?.addEventListener('click', () => {
    root.querySelectorAll('tr[data-id]').forEach(tr => {
      const inp = tr.querySelector('.val');
      if (inp.value === '' && tr.dataset.prev !== '') inp.value = tr.dataset.prev;
    });
    updateChanges();
  });

  $('#saveGrid')?.addEventListener('click', guard(async () => {
    const entries = [...root.querySelectorAll('tr[data-id]')].map(tr => ({
      account_id: Number(tr.dataset.id),
      value: tr.querySelector('.val').value,
      contributions: tr.querySelector('.contrib').value,
    }));
    await api('/snapshots', { method: 'PUT', body: { month, entries } });
    toast(`Values for ${monthLabel(month, 'long')} saved`);
    investments(root, params);
  }));

  const accountForm = (a = {}) => `<div class="form-grid">
    <label class="field">Name<input name="name" required value="${esc(a.name || '')}" placeholder="e.g. Indexa Capital"></label>
    <label class="field">Type<select name="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field wide">Notes<input name="notes" value="${esc(a.notes || '')}"></label>
    ${a.id ? `<label class="row small" style="gap:6px"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active (shown in monthly update)</label>` : ''}
  </div>`;

  $('#addAcc').onclick = () => modal({
    title: 'Add account', body: accountForm(), submitLabel: 'Add',
    onSubmit: async form => { await api('/accounts', { method: 'POST', body: formData(form) }); investments(root, params); },
  });

  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const a = accounts.find(x => x.id === Number(b.dataset.edit));
    const { close } = modal({
      title: `Edit ${a.name}`, body: accountForm(a),
      extraButtons: '<button type="button" class="danger" data-del>Delete</button>',
      onSubmit: async form => {
        const d = formData(form);
        await api(`/accounts/${a.id}`, { method: 'PUT', body: { ...d, active: !!d.active } });
        investments(root, params);
      },
    });
    document.querySelector('dialog [data-del]').onclick = guard(async () => {
      close();
      if (await confirmDialog('Delete account', `Delete “${esc(a.name)}” and all its monthly values? Consider archiving instead.`)) {
        await api(`/accounts/${a.id}`, { method: 'DELETE' });
        investments(root, params);
      }
    });
  });

  // History chart: total of all accounts by default, a single account when its row is clicked.
  let histChart;
  const showHistory = guard(async accountId => {
    let series, title;
    if (accountId) {
      const a = accounts.find(x => x.id === accountId);
      series = await api(`/accounts/${accountId}/history`);
      title = `${a.name} · value`;
    } else {
      const nw = await api('/reports/networth');
      series = nw.filter(n => n.cash || n.investments).map(n => ({ month: n.month, value: n.cash + n.investments, contributions: n.contributions }));
      title = 'All accounts · total value';
    }
    $('#histTitle').textContent = title;
    histChart?.destroy();
    const color = cssVar('--series-1');
    histChart = chart($('#histChart'), {
      type: 'line',
      data: { labels: series.map(s => monthLabel(s.month)), datasets: [{ label: 'Value', data: series.map(s => s.value), borderColor: color, backgroundColor: color + '22', fill: true, borderWidth: 2, pointRadius: series.length < 24 ? 3 : 0, pointHoverRadius: 6, tension: 0.25 }] },
    });
    const rows = series.slice(-12).reverse().map((s, i, arr) => {
      const prev = arr[i + 1];
      const gain = prev ? s.value - prev.value - (s.contributions || 0) : null;
      return `<tr><td>${esc(monthLabel(s.month, 'long'))}</td><td class="num">${money(s.value)}</td><td class="num muted">${s.contributions ? money(s.contributions, { sign: true }) : '—'}</td>
        <td class="num ${gain === null ? 'muted' : gain >= 0 ? 'pos' : 'neg'}">${gain === null ? '—' : `${money(gain, { sign: true })} (${pct(gain / prev.value, 1)})`}</td></tr>`;
    }).join('');
    $('#histTable').innerHTML = series.length ? `<div class="table-wrap" style="max-height:260px"><table class="small">
      <thead><tr><th>Month</th><th class="num">Value</th><th class="num">Contributed</th><th class="num">Market change</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${accountId ? '<button class="link small" id="showAll" style="margin-top:8px">← Show all accounts</button>' : '<p class="small muted">Click an account to see its own history.</p>'}` : '<div class="muted">No values recorded yet.</div>';
    $('#showAll')?.addEventListener('click', () => showHistory(null));
  });
  root.querySelectorAll('tr[data-acc]').forEach(tr => tr.onclick = () => showHistory(Number(tr.dataset.acc)));
  showHistory(null);
}
