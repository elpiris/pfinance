import { api, state, money, dateLabel, esc, toast, guard, modal, confirmDialog, formData, today, pct, chart, cssVar, legendHTML } from '../util.js';

// Typical yearly loss of value for a used car; only used to pre-fill an estimate the user can overwrite.
const VEHICLE_DEPRECIATION = 0.15;

const KINDS = {
  real_estate: {
    title: 'Real estate', noun: 'property', add: '+ Add property', loan: 'Mortgage', loanLower: 'mortgage',
    namePlaceholder: 'e.g. Home, Beach apartment', valueLabel: 'Property value (your share)',
    empty: 'No properties yet. Add your home or any real estate you own to include it in your net worth.',
  },
  vehicle: {
    title: 'Vehicles', noun: 'vehicle', add: '+ Add vehicle', loan: 'Car loan', loanLower: 'loan',
    namePlaceholder: 'e.g. Family car', valueLabel: 'Resale value (your share)',
    empty: 'No vehicles yet. Add your car to track its loan and resale value.',
  },
};

const monthsBetween = (from, to) =>
  (new Date(to).getFullYear() - new Date(from).getFullYear()) * 12 + new Date(to).getMonth() - new Date(from).getMonth();

// Project a loan balance forward from a known balance using the standard amortization formula.
function estimateBalance(balance, fromDate, toDate, ratePct, payment) {
  if (!balance || !payment || !fromDate) return null;
  const months = monthsBetween(fromDate, toDate);
  if (months <= 0) return balance;
  const r = (ratePct || 0) / 1200;
  const b = r ? balance * (1 + r) ** months - payment * (((1 + r) ** months - 1) / r) : balance - payment * months;
  return Math.max(0, Math.round(b * 100) / 100);
}

function estimateVehicleValue(value, fromDate, toDate) {
  if (!value || !fromDate) return null;
  const years = (new Date(toDate) - new Date(fromDate)) / (365.25 * 864e5);
  if (years < 1 / 12) return null;
  return Math.round((value * (1 - VEHICLE_DEPRECIATION) ** years) / 50) * 50;
}

const assetForm = (cfg, kind, p = {}, isNew = false) => `
  <div class="form-grid">
    <label class="field">Name<input name="name" required value="${esc(p.name || '')}" placeholder="${esc(cfg.namePlaceholder)}"></label>
    <label class="field">Ownership %<input type="number" name="ownership_pct" min="0" max="100" step="0.01" value="${p.ownership_pct ?? 100}"></label>
    ${kind === 'vehicle' ? `
      <label class="field">Make &amp; model<input name="model" value="${esc(p.model || '')}" placeholder="e.g. Toyota Corolla 1.8 Hybrid"></label>
      <label class="field">Year<input type="number" name="year" min="1950" max="2100" value="${p.year ?? ''}"></label>`
    : `<label class="field wide">Address<input name="address" value="${esc(p.address || '')}"></label>`}
    <label class="field">Purchase date<input type="date" name="purchase_date" value="${p.purchase_date || ''}"></label>
    <label class="field">Purchase price<input type="number" step="0.01" name="purchase_price" value="${p.purchase_price ?? ''}"></label>
    ${kind === 'real_estate' ? `<label class="field">Monthly rent received<input type="number" step="0.01" name="monthly_rent" value="${p.monthly_rent ?? ''}" placeholder="if rented out"></label>` : ''}
  </div>
  <h3 style="margin-top:18px">${cfg.loan} <span class="muted small" style="font-weight:400">(leave empty if none)</span></h3>
  <div class="form-grid">
    <label class="field">Lender<input name="lender" value="${esc(p.lender || '')}"></label>
    <label class="field">Initial amount<input type="number" step="0.01" name="mortgage_initial" value="${p.mortgage_initial ?? ''}"></label>
    <label class="field">Interest rate (% / year, TIN)<input type="number" step="0.001" name="interest_rate" value="${p.interest_rate ?? ''}"></label>
    <label class="field">Monthly payment<input type="number" step="0.01" name="monthly_payment" value="${p.monthly_payment ?? ''}"></label>
    <label class="field">End date<input type="date" name="mortgage_end" value="${p.mortgage_end || ''}"></label>
  </div>
  ${isNew ? `<h3 style="margin-top:18px">Today</h3>
  <div class="form-grid">
    <label class="field">${kind === 'vehicle' ? 'Resale value today' : 'Market value today'}<input type="number" step="0.01" name="market_value" required></label>
    <label class="field">Outstanding ${cfg.loanLower} today<input type="number" step="0.01" name="mortgage_balance" value="0"></label>
    <label class="field">As of<input type="date" name="valuation_date" value="${today()}"></label>
  </div>
  ${kind === 'vehicle' ? '<p class="small subtle">Tip: for the resale value, check what similar cars (same model, year and mileage) are listed for on second-hand sites, and be conservative.</p>' : ''}` : ''}
  <label class="field wide" style="margin-top:12px">Notes<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>`;

export const realEstate = root => assetsView(root, 'real_estate');
export const vehicles = root => assetsView(root, 'vehicle');

async function assetsView(root, kind) {
  const cfg = KINDS[kind];
  // Filter client-side too: a server older than the vehicles feature ignores ?kind and returns everything.
  const props = (await api(`/properties?kind=${kind}`)).filter(p => (p.kind ?? 'real_estate') === kind);
  const reload = () => assetsView(root, kind);
  const valueExcluded = kind === 'vehicle' && state.settings.includeVehicleValue === false;

  const totals = props.reduce((t, p) => {
    const share = (p.ownership_pct ?? 100) / 100;
    t.value += (p.market_value || 0) * share;
    t.debt += (p.mortgage_balance || 0) * share;
    return t;
  }, { value: 0, debt: 0 });

  root.innerHTML = `
    <div class="page-head"><h1>${cfg.title}</h1><span class="spacer"></span><button class="primary" id="addProp">${cfg.add}</button></div>
    ${props.length ? `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">${cfg.valueLabel}</div><div class="value">${money(totals.value, { decimals: 0 })}</div>
        ${valueExcluded ? '<div class="delta muted">Not counted in net worth (see <a href="#/settings" style="color:var(--accent)">Settings</a>)</div>' : ''}</div>
      <div class="card kpi"><div class="label">${cfg.loan} debt</div><div class="value">${money(totals.debt, { decimals: 0 })}</div>
        <div class="delta muted">Always counted in net worth</div></div>
      <div class="card kpi"><div class="label">Equity</div><div class="value ${totals.value - totals.debt < 0 ? 'neg' : ''}">${money(totals.value - totals.debt, { decimals: 0 })}</div>
        <div class="delta muted">${totals.value ? `${pct(totals.debt / totals.value)} loan-to-value` : ''}</div></div>
    </div>
    <div class="stack" style="margin-top:16px">${props.map(p => {
      const equity = (p.market_value || 0) - (p.mortgage_balance || 0);
      const change = p.purchase_price && p.market_value ? p.market_value - p.purchase_price : null;
      const paidOff = p.mortgage_initial && p.mortgage_balance !== null ? 1 - p.mortgage_balance / p.mortgage_initial : null;
      const monthsLeft = p.mortgage_end && p.mortgage_balance ? monthsBetween(today(), p.mortgage_end) : null;
      const subtitle = kind === 'vehicle' ? [p.model, p.year].filter(Boolean).join(' · ') : p.address;
      return `<div class="card" data-id="${p.id}">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h2 style="margin:0">${esc(p.name)}</h2>
            <div class="small subtle">${esc(subtitle || '')}${p.ownership_pct !== 100 ? ` · you own ${p.ownership_pct}%` : ''}</div></div>
          <div class="row"><button class="primary" data-act="update">Update value / ${cfg.loanLower}</button><button data-act="edit">Edit</button></div>
        </div>
        <div class="grid kpis" style="margin-top:14px;gap:12px">
          <div class="kpi"><div class="label">${kind === 'vehicle' ? 'Resale value' : 'Market value'}</div><div class="value" style="font-size:20px">${money(p.market_value, { decimals: 0 })}</div>
            <div class="delta muted">${p.valuation_date ? `as of ${esc(dateLabel(p.valuation_date))}` : 'no valuation yet'}</div></div>
          <div class="kpi"><div class="label">${cfg.loan} outstanding</div><div class="value" style="font-size:20px">${money(p.mortgage_balance || 0, { decimals: 0 })}</div>
            ${paidOff !== null ? `<div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, paidOff * 100))}%"></div></div>
            <div class="delta muted">${pct(paidOff)} paid off of ${money(p.mortgage_initial, { decimals: 0 })}${monthsLeft > 0 ? ` · ${monthsLeft} payments left` : ''}</div>` : ''}</div>
          <div class="kpi"><div class="label">Equity</div><div class="value ${equity < 0 ? 'neg' : ''}" style="font-size:20px">${money(equity, { decimals: 0 })}</div>
            ${equity < 0 ? '<div class="delta neg">You owe more than it’s worth</div>' : p.market_value ? `<div class="delta muted">${pct((p.mortgage_balance || 0) / p.market_value)} LTV</div>` : ''}</div>
          <div class="kpi"><div class="label">${kind === 'vehicle' ? 'Depreciation' : 'Since purchase'}</div><div class="value" style="font-size:20px">${change === null ? '—' : money(change, { sign: true, decimals: 0 })}</div>
            ${change !== null ? `<div class="delta ${change >= 0 ? 'pos' : 'neg'}">${pct(change / p.purchase_price, 1)} on ${money(p.purchase_price, { decimals: 0 })}</div>` : ''}</div>
        </div>
        <div class="row small subtle" style="margin-top:12px;gap:18px">
          ${p.lender ? `<span>Lender: ${esc(p.lender)}</span>` : ''}
          ${p.interest_rate !== null ? `<span>Rate: ${p.interest_rate}%</span>` : ''}
          ${p.monthly_payment ? `<span>Payment: ${money(p.monthly_payment)}/mo</span>` : ''}
          ${p.mortgage_end ? `<span>Ends: ${esc(dateLabel(p.mortgage_end))}</span>` : ''}
          ${p.monthly_rent ? `<span>Rent: ${money(p.monthly_rent)}/mo${p.market_value ? ` (gross yield ${pct((p.monthly_rent * 12) / p.market_value, 1)})` : ''}</span>` : ''}
          <button class="link small" data-act="history">History ▾</button>
        </div>
        <div class="history" style="display:none;margin-top:12px"></div>
      </div>`;
    }).join('')}</div>` : `<div class="card empty">${cfg.empty}</div>`}`;

  root.querySelector('#addProp').onclick = () => modal({
    title: cfg.add.replace('+ ', ''), body: assetForm(cfg, kind, {}, true), submitLabel: cfg.add.replace('+ ', ''),
    onSubmit: async form => { await api('/properties', { method: 'POST', body: { ...formData(form), kind } }); toast(`${cfg.noun[0].toUpperCase()}${cfg.noun.slice(1)} added`); reload(); },
  });

  root.querySelectorAll('.card[data-id]').forEach(card => {
    const p = props.find(x => x.id === Number(card.dataset.id));
    card.addEventListener('click', guard(async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') editAsset(p);
      if (act === 'update') updateValuation(p);
      if (act === 'history') toggleHistory(p, card);
    }));
  });

  function editAsset(p) {
    const { close } = modal({
      title: `Edit ${p.name}`, body: assetForm(cfg, kind, p),
      extraButtons: '<button type="button" class="danger" data-del>Delete</button>',
      onSubmit: async form => { await api(`/properties/${p.id}`, { method: 'PUT', body: formData(form) }); reload(); },
    });
    document.querySelector('dialog [data-del]').onclick = guard(async () => {
      close();
      if (await confirmDialog(`Delete ${cfg.noun}`, `Delete “${esc(p.name)}” and all its valuation history?`)) {
        await api(`/properties/${p.id}`, { method: 'DELETE' });
        reload();
      }
    });
  }

  function updateValuation(p) {
    const estLoan = estimateBalance(p.mortgage_balance, p.valuation_date, today(), p.interest_rate, p.monthly_payment);
    const estValue = kind === 'vehicle' ? estimateVehicleValue(p.market_value, p.valuation_date, today()) : null;
    const notes = [];
    if (estValue !== null) notes.push(`Value pre-filled assuming ~${VEHICLE_DEPRECIATION * 100}% depreciation per year since ${esc(dateLabel(p.valuation_date))} (${money(p.market_value, { decimals: 0 })}). Check second-hand listings for a real figure.`);
    if (estLoan !== null && estLoan !== p.mortgage_balance) notes.push(`${cfg.loan} pre-filled with an estimate of ${money(estLoan)} based on your rate and monthly payment since the last update (${money(p.mortgage_balance)} on ${esc(dateLabel(p.valuation_date))}). Replace it with the figure from your lender if you have it.`);
    modal({
      title: `Update ${p.name}`,
      body: `<div class="form-grid">
        <label class="field">Date<input type="date" name="date" value="${today()}" required></label>
        <label class="field">${kind === 'vehicle' ? 'Resale value' : 'Market value'}<input type="number" step="0.01" name="market_value" required value="${estValue ?? p.market_value ?? ''}"></label>
        <label class="field">Outstanding ${cfg.loanLower}<input type="number" step="0.01" name="mortgage_balance" value="${estLoan ?? p.mortgage_balance ?? 0}"></label>
        <label class="field wide">Note<input name="note" placeholder="${kind === 'vehicle' ? 'e.g. coches.net average, 85.000 km' : 'e.g. Idealista estimate, bank appraisal'}"></label></div>
        ${notes.map(n => `<p class="small subtle">${n}</p>`).join('')}`,
      onSubmit: async form => {
        await api(`/properties/${p.id}/snapshots`, { method: 'POST', body: formData(form) });
        toast('Valuation saved');
        reload();
      },
    });
  }

  async function toggleHistory(p, card) {
    const box = card.querySelector('.history');
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    const snaps = await api(`/properties/${p.id}/snapshots`);
    box.style.display = '';
    const asc = [...snaps].reverse();
    const valueName = kind === 'vehicle' ? 'Resale value' : 'Market value';
    box.innerHTML = `
      ${asc.length > 1 ? `${legendHTML([[valueName, cssVar('--series-1')], [cfg.loan, cssVar('--series-2')]])}<div class="chart-box short"><canvas></canvas></div>` : ''}
      <div class="table-wrap"><table class="small">
        <thead><tr><th>Date</th><th class="num">${valueName}</th><th class="num">${cfg.loan}</th><th class="num">Equity</th><th>Note</th><th></th></tr></thead>
        <tbody>${snaps.map(s => `<tr><td>${esc(dateLabel(s.date))}</td><td class="num">${money(s.market_value)}</td><td class="num">${money(s.mortgage_balance)}</td>
          <td class="num">${money(s.market_value - s.mortgage_balance)}</td><td>${esc(s.note || '')}</td>
          <td class="num"><button class="link danger" data-snap="${s.id}">✕</button></td></tr>`).join('')}</tbody>
      </table></div>`;
    if (asc.length > 1) {
      const line = (label, key, color) => ({ label, data: asc.map(s => s[key]), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 });
      chart(box.querySelector('canvas'), {
        type: 'line',
        data: { labels: asc.map(s => dateLabel(s.date)), datasets: [line(valueName, 'market_value', cssVar('--series-1')), line(cfg.loan, 'mortgage_balance', cssVar('--series-2'))] },
      });
    }
    box.querySelectorAll('[data-snap]').forEach(b => b.onclick = guard(async e => {
      e.stopPropagation();
      if (!await confirmDialog('Delete valuation', 'Delete this valuation entry?')) return;
      await api(`/property-snapshots/${b.dataset.snap}`, { method: 'DELETE' });
      reload();
    }));
  }
}
