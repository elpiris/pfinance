import { api, state, loadCategories, destroyCharts, toast } from './util.js';
import dashboard from './views/dashboard.js';
import transactions from './views/transactions.js';
import month from './views/month.js';
import importView from './views/import.js';
import budget from './views/budget.js';
import investments from './views/investments.js';
import { realEstate, vehicles } from './views/properties.js';
import categories from './views/categories.js';
import settings from './views/settings.js';

const routes = { dashboard, month, transactions, import: importView, budget, investments, properties: realEstate, vehicles, categories, settings };

async function render() {
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const view = routes[name] || dashboard;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  destroyCharts();
  const root = document.getElementById('view');
  root.innerHTML = '<div class="muted">Loading…</div>';
  try {
    await view(root, new URLSearchParams(query || ''));
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="card empty">Something went wrong: ${err.message}</div>`;
    toast(err.message, true);
  }
  window.scrollTo(0, 0);
}

async function boot() {
  state.settings = await api('/settings');
  await loadCategories();
  window.addEventListener('hashchange', render);
  // Re-render charts with the right colors when the OS theme flips.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  render();
}

boot();
