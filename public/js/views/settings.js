import { api, state, esc, toast, guard } from '../util.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'BRL', 'JPY', 'CAD', 'AUD'];
const LOCALES = [['es-ES', 'Español (1.234,56 €)'], ['en-GB', 'English UK (€1,234.56)'], ['en-US', 'English US ($1,234.56)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français']];

const size = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = iso => new Date(iso).toLocaleString(state.settings.locale, { dateStyle: 'medium', timeStyle: 'short' });

export default async function settings(root) {
  const { backups } = await api('/backups');
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
        <h2>Your data</h2>
        <p class="subtle" style="margin-top:0">Everything is stored on this computer, outside the app folder, so updating or deleting the app doesn’t touch it:</p>
        <p><code>${esc(state.settings.dataDir)}</code></p>
        ${state.settings.migratedFrom ? `<p class="small subtle">Your data was copied here from <code>${esc(state.settings.migratedFrom)}</code>.
          That old folder was left as it was; once everything looks right you can delete it.</p>` : ''}
        <button id="openDir">Open folder</button>
      </div>
      <div class="card">
        <h2>Backups</h2>
        <p class="subtle" style="margin-top:0">PFinance makes an automatic backup once a day while it’s running and keeps the last 14.
          “Back up now” makes a single file you can download and keep somewhere else (a USB drive, cloud storage…).</p>
        <div class="row" style="gap:8px;margin-bottom:12px">
          <button class="primary" id="backupNow">Back up now</button>
          <a class="btn" href="/api/export" download>Download JSON export</a>
        </div>
        ${backups.length ? `<div class="table-wrap"><table><thead><tr><th>Created</th><th>Type</th><th class="num">Size</th><th></th></tr></thead><tbody>
          ${backups.map(b => `<tr><td>${esc(when(b.created))}</td><td>${b.kind === 'auto' ? 'Automatic' : 'Manual'}</td>
            <td class="num">${size(b.size)}</td><td class="num"><a href="/api/backups/${encodeURIComponent(b.name)}" download>Download</a></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="small subtle">No backups yet.</p>'}
        <details style="margin-top:12px"><summary>How to restore a backup</summary>
          <ol class="small">
            <li>Close PFinance (close its terminal window).</li>
            <li>Open the data folder above and move <code>finance.db</code> somewhere safe, in case you want it back.</li>
            <li>Delete <code>finance.db-wal</code> and <code>finance.db-shm</code> if they’re there.</li>
            <li>Copy the backup file into the folder and rename it to <code>finance.db</code>.</li>
            <li>Start PFinance again.</li>
          </ol>
        </details>
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
  root.querySelector('#openDir').onclick = guard(() => api('/open-data-folder', { method: 'POST' }));
  root.querySelector('#backupNow').onclick = guard(async e => {
    e.target.disabled = true;
    const { name } = await api('/backups', { method: 'POST' });
    toast('Backup created');
    await settings(root);
    location.href = `/api/backups/${encodeURIComponent(name)}`;
  });
  root.querySelector('#clearMap').onclick = guard(async () => {
    await api('/settings', { method: 'PUT', body: { importMapping: null } });
    state.settings.importMapping = null;
    toast('Saved layouts cleared');
    settings(root);
  });
}
