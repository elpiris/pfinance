import { api, state, esc, toast, guard } from '../util.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'BRL', 'JPY', 'CAD', 'AUD'];
const LOCALES = [['es-ES', 'Español (1.234,56 €)'], ['en-GB', 'English UK (€1,234.56)'], ['en-US', 'English US ($1,234.56)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français']];

export default async function settings(root) {
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="stack" style="max-width:640px">
      <div class="card">
        <h2>Display</h2>
        <form id="f" class="form-grid">
          <label class="field">Currency<select name="currency">${CURRENCIES.map(c => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field">Number &amp; date format<select name="locale">${LOCALES.map(([v, l]) => `<option value="${v}" ${v === state.settings.locale ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <div class="wide"><button class="primary">Save</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Net worth</h2>
        <label class="row" style="gap:8px;align-items:flex-start">
          <input type="checkbox" id="vehValue" ${state.settings.includeVehicleValue !== false ? 'checked' : ''} style="margin-top:3px">
          <span>Count vehicles’ resale value as an asset
            <div class="small subtle">Car loans are always counted as debt. Turn this off for a more conservative net worth
              that ignores what your car could be sold for.</div></span>
        </label>
      </div>
      <div class="card">
        <h2>Backup</h2>
        <p class="subtle" style="margin-top:0">All your data lives in a single file on this computer: <code>data/finance.db</code> inside the app folder.
          Copy that file to back up everything, or download a JSON export:</p>
        <a class="btn" href="/api/export" download>Download JSON export</a>
      </div>
      <div class="card">
        <h2>Saved import layouts</h2>
        <p class="subtle" style="margin-top:0">Column mappings remembered from previous imports: ${Object.keys(state.settings.importMapping || {}).length}</p>
        <button id="clearMap">Forget saved layouts</button>
      </div>
    </div>`;

  root.querySelector('#f').onsubmit = guard(async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await api('/settings', { method: 'PUT', body: d });
    Object.assign(state.settings, d);
    toast('Settings saved');
  });
  root.querySelector('#vehValue').onchange = guard(async e => {
    await api('/settings', { method: 'PUT', body: { includeVehicleValue: e.target.checked } });
    state.settings.includeVehicleValue = e.target.checked;
    toast(e.target.checked ? 'Vehicle value now counted in net worth' : 'Vehicle value excluded from net worth (loans still counted)');
  });
  root.querySelector('#clearMap').onclick = guard(async () => {
    await api('/settings', { method: 'PUT', body: { importMapping: null } });
    state.settings.importMapping = null;
    toast('Saved layouts cleared');
    settings(root);
  });
}
