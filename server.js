import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { db, tx, setting, setSetting, normalize, DB_PATH } from './src/db.js';
import { createCategorizer, merchantKey } from './src/categorize.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '25mb' }));
// Always revalidate (cheap with ETags) so the browser never runs stale app code after an update.
app.use(express.static(path.join(ROOT, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules/chart.js/dist')));
app.use('/vendor/xlsx', express.static(path.join(ROOT, 'node_modules/xlsx/dist')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const route = fn => (req, res) => {
  try {
    const out = fn(req, res);
    res.json(out ?? { ok: true });
  } catch (err) {
    const status = err.status || (/UNIQUE constraint/.test(err.message) ? 409 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: /UNIQUE constraint/.test(err.message) ? 'That name already exists.' : err.message });
  }
};

const num = (v, def = null) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? def : Number(v));
const str = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const isMonth = m => /^\d{4}-\d{2}$/.test(m);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
const round2 = n => Math.round(n * 100) / 100;

function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
const currentMonth = () => new Date().toISOString().slice(0, 7);
function addMonths(month, n) {
  let [y, m] = month.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

/* ---------------- Settings ---------------- */

app.get('/api/settings', route(() => ({
  currency: setting('currency', 'EUR'),
  locale: setting('locale', 'es-ES'),
  importMapping: setting('importMapping', null),
  balanceAccountId: setting('balanceAccountId', null),
  includeVehicleValue: setting('includeVehicleValue', true),
})));

app.put('/api/settings', route(req => {
  for (const key of ['currency', 'locale', 'importMapping', 'balanceAccountId', 'includeVehicleValue']) {
    if (key in req.body) setSetting(key, req.body[key]);
  }
}));

/* ---------------- Categories & rules ---------------- */

app.get('/api/categories', route(() => db.prepare(`
  SELECT c.*, COUNT(t.id) AS tx_count,
    (SELECT COUNT(*) FROM rules r WHERE r.category_id = c.id) AS rule_count
  FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
  GROUP BY c.id ORDER BY c.kind = 'income' DESC, c.kind = 'transfer', c."group", c.name`).all()));

function categoryFields(b) {
  const kind = ['expense', 'income', 'transfer'].includes(b.kind) ? b.kind : 'expense';
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'Name is required.');
  return [name, kind, str(b.color) || '#888888', num(b.budget), str(b.group)];
}

app.post('/api/categories', route(req => {
  const r = db.prepare('INSERT INTO categories(name, kind, color, budget, "group") VALUES(?,?,?,?,?)').run(...categoryFields(req.body));
  return { id: Number(r.lastInsertRowid) };
}));

app.put('/api/categories/:id', route(req => {
  db.prepare('UPDATE categories SET name=?, kind=?, color=?, budget=?, "group"=? WHERE id=?').run(...categoryFields(req.body), req.params.id);
}));

app.delete('/api/categories/:id', route(req => {
  const fallback = db.prepare("SELECT id FROM categories WHERE name = 'Uncategorized'").get();
  if (fallback && Number(req.params.id) === fallback.id) throw new HttpError(400, 'The Uncategorized category cannot be deleted.');
  tx(() => {
    db.prepare('UPDATE transactions SET category_id = ?, manual = 0 WHERE category_id = ?').run(fallback?.id ?? null, req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  });
}));

app.get('/api/rules', route(() => db.prepare(`
  SELECT r.*, c.name AS category_name, c.color FROM rules r JOIN categories c ON c.id = r.category_id
  ORDER BY r.source = 'user' DESC, c.name, r.pattern`).all()));

// Re-run categorization over every transaction the user hasn't categorized by hand.
function reapplyRules() {
  const categorize = createCategorizer();
  const rows = db.prepare('SELECT id, concept, amount, category_id FROM transactions WHERE manual = 0').all();
  const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let changed = 0;
  tx(() => {
    for (const r of rows) {
      const { category_id } = categorize(r.concept, r.amount);
      if (category_id !== r.category_id) { upd.run(category_id, r.id); changed++; }
    }
  });
  return changed;
}

app.post('/api/rules', route(req => {
  const pattern = normalize(req.body.pattern);
  if (pattern.length < 2) throw new HttpError(400, 'Pattern must be at least 2 characters.');
  const category_id = num(req.body.category_id);
  if (!category_id) throw new HttpError(400, 'Category is required.');
  db.prepare(`INSERT INTO rules(pattern, category_id, priority, source) VALUES(?, ?, 10, 'user')
    ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, priority = 10, source = 'user'`).run(pattern, category_id);
  return { changed: reapplyRules() };
}));

app.delete('/api/rules/:id', route(req => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  return { changed: reapplyRules() };
}));

app.post('/api/rules/reapply', route(() => ({ changed: reapplyRules() })));

/* ---------------- Import ---------------- */

function cleanImportRows(rows) {
  if (!Array.isArray(rows)) throw new HttpError(400, 'rows must be an array.');
  return rows.map((r, index) => ({
    index,
    date: String(r.date || ''),
    concept: String(r.concept || '').trim(),
    amount: num(r.amount),
    balance: num(r.balance),
    category_id: num(r.category_id),
  })).filter(r => isDate(r.date) && r.concept && r.amount !== null && r.amount !== 0);
}

// Same date+amount+concept can legitimately repeat within one statement (two coffees),
// so the occurrence number is part of the fingerprint. Re-importing an overlapping
// statement then reproduces identical fingerprints and those rows are skipped.
function fingerprints(rows) {
  const seen = new Map();
  return rows.map(r => {
    const base = `${r.date}|${r.amount.toFixed(2)}|${normalize(r.concept)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

// A row is already imported if its fingerprint matches, or, for statements of the same account exported
// in another format (different concept text), if the amount and running balance match within a few days.
// The balance changes after every movement, so two different transactions can't share all three.
// Rows of the import being written are excluded: within one file, +20/-20/+20 can legitimately repeat a balance.
function duplicateChecker(currentImportId = -1) {
  const byFingerprint = db.prepare('SELECT 1 FROM transactions WHERE fingerprint = ?');
  const byBalance = db.prepare(`SELECT 1 FROM transactions
    WHERE amount = ? AND balance IS NOT NULL AND ABS(balance - ?) < 0.005
      AND COALESCE(original_date, date) BETWEEN date(?, '-3 days') AND date(?, '+3 days')
      AND COALESCE(import_id, 0) != ? LIMIT 1`);
  return (row, fingerprint) => !!byFingerprint.get(fingerprint)
    || (row.balance !== null && !!byBalance.get(round2(row.amount), row.balance, row.date, row.date, currentImportId));
}

app.post('/api/import/preview', route(req => {
  const rows = cleanImportRows(req.body.rows);
  const categorize = createCategorizer();
  const fps = fingerprints(rows);
  const isDuplicate = duplicateChecker();
  return {
    rows: rows.map((r, i) => {
      const { category_id, reason } = categorize(r.concept, r.amount);
      return { ...r, category_id, reason, duplicate: isDuplicate(r, fps[i]) };
    }),
  };
}));

app.post('/api/import/commit', route(req => {
  const rows = cleanImportRows(req.body.rows);
  if (!rows.length) throw new HttpError(400, 'No valid rows to import.');
  const fps = fingerprints(rows);
  const categorize = createCategorizer();
  const balanceAccountId = num(req.body.balanceAccountId);

  return tx(() => {
    const imp = db.prepare('INSERT INTO imports(filename) VALUES(?)').run(str(req.body.filename));
    const importId = Number(imp.lastInsertRowid);
    const isDuplicate = duplicateChecker(importId);
    const ins = db.prepare(`INSERT OR IGNORE INTO transactions(date, concept, amount, balance, category_id, manual, import_id, fingerprint)
      VALUES(?,?,?,?,?,?,?,?)`);
    let inserted = 0;
    rows.forEach((r, i) => {
      if (isDuplicate(r, fps[i])) return;
      const auto = categorize(r.concept, r.amount).category_id;
      const category = r.category_id ?? auto;
      // A category changed in the preview counts as a manual decision and teaches the categorizer.
      const manual = r.category_id && r.category_id !== auto ? 1 : 0;
      const res = ins.run(r.date, r.concept, round2(r.amount), r.balance, category, manual, importId, fps[i]);
      inserted += Number(res.changes);
    });
    db.prepare('UPDATE imports SET row_count = ?, skipped = ? WHERE id = ?').run(inserted, rows.length - inserted, importId);

    // Use the statement's running balance as the month-end value of the linked cash account.
    let balancesSet = 0;
    if (balanceAccountId && rows.some(r => r.balance !== null)) {
      const descending = rows[0].date > rows[rows.length - 1].date;
      const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (descending ? b.index - a.index : a.index - b.index));
      const lastByMonth = new Map();
      for (const r of ordered) if (r.balance !== null) lastByMonth.set(r.date.slice(0, 7), r.balance);
      const up = db.prepare(`INSERT INTO account_snapshots(account_id, month, value) VALUES(?,?,?)
        ON CONFLICT(account_id, month) DO UPDATE SET value = excluded.value`);
      for (const [month, value] of lastByMonth) { up.run(balanceAccountId, month, value); balancesSet++; }
      setSetting('balanceAccountId', balanceAccountId);
    }
    return { importId, inserted, skipped: rows.length - inserted, balancesSet };
  });
}));

app.get('/api/imports', route(() => db.prepare(`
  SELECT i.*, MIN(t.date) AS first_date, MAX(t.date) AS last_date
  FROM imports i LEFT JOIN transactions t ON t.import_id = i.id
  GROUP BY i.id ORDER BY i.id DESC`).all()));

app.delete('/api/imports/:id', route(req => {
  tx(() => {
    db.prepare('DELETE FROM transactions WHERE import_id = ?').run(req.params.id);
    db.prepare('DELETE FROM imports WHERE id = ?').run(req.params.id);
  });
}));

/* ---------------- Transactions ---------------- */

app.get('/api/transactions', route(req => {
  const where = [];
  const params = [];
  const q = req.query;
  if (q.month && isMonth(q.month)) { where.push("substr(t.date, 1, 7) = ?"); params.push(q.month); }
  if (q.from && isDate(q.from)) { where.push('t.date >= ?'); params.push(q.from); }
  if (q.to && isDate(q.to)) { where.push('t.date <= ?'); params.push(q.to); }
  if (q.category_id) { where.push('t.category_id = ?'); params.push(Number(q.category_id)); }
  if (q.type === 'income') where.push('t.amount > 0');
  if (q.type === 'expense') where.push('t.amount < 0');
  if (q.q) { where.push('(t.concept LIKE ? OR t.notes LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const sql = `SELECT t.*, c.name AS category_name, c.color, c.kind FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.date DESC, t.id DESC LIMIT 5000`;
  return db.prepare(sql).all(...params);
}));

app.get('/api/transactions/months', route(() =>
  db.prepare("SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC").all().map(r => r.month)));

app.post('/api/transactions', route(req => {
  const b = req.body;
  if (!isDate(b.date)) throw new HttpError(400, 'Valid date required.');
  const amount = num(b.amount);
  if (!amount) throw new HttpError(400, 'Amount required (negative for expenses).');
  const concept = str(b.concept);
  if (!concept) throw new HttpError(400, 'Concept required.');
  const category_id = num(b.category_id) ?? createCategorizer()(concept, amount).category_id;
  const r = db.prepare('INSERT INTO transactions(date, concept, amount, category_id, manual, notes) VALUES(?,?,?,?,?,?)')
    .run(b.date, concept, round2(amount), category_id, b.category_id ? 1 : 0, str(b.notes));
  return { id: Number(r.lastInsertRowid) };
}));

app.patch('/api/transactions/:id', route(req => {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!t) throw new HttpError(404, 'Transaction not found.');
  const b = req.body;
  let similarUpdated = 0;
  tx(() => {
    if ('notes' in b) db.prepare('UPDATE transactions SET notes = ? WHERE id = ?').run(str(b.notes), t.id);
    if ('date' in b && b.date !== t.date) {
      if (!isDate(b.date)) throw new HttpError(400, 'Valid date required.');
      // Remember the bank's date the first time it moves; moving it back clears the marker.
      const bankDate = t.original_date || t.date;
      db.prepare('UPDATE transactions SET date = ?, original_date = ? WHERE id = ?').run(b.date, b.date === bankDate ? null : bankDate, t.id);
    }
    if ('category_id' in b) {
      const cat = num(b.category_id);
      db.prepare('UPDATE transactions SET category_id = ?, manual = 1 WHERE id = ?').run(cat, t.id);
      if (b.applyToSimilar) {
        const key = merchantKey(t.concept);
        const upd = db.prepare('UPDATE transactions SET category_id = ?, manual = 1 WHERE id = ?');
        for (const o of db.prepare('SELECT id, concept FROM transactions WHERE id != ? AND manual = 0').all(t.id)) {
          if (merchantKey(o.concept) === key) { upd.run(cat, o.id); similarUpdated++; }
        }
      }
    }
  });
  return { similarUpdated };
}));

app.post('/api/transactions/bulk', route(req => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  const cat = num(req.body.category_id);
  const upd = db.prepare('UPDATE transactions SET category_id = ?, manual = 1 WHERE id = ?');
  tx(() => ids.forEach(id => upd.run(cat, id)));
  return { updated: ids.length };
}));

app.delete('/api/transactions/:id', route(req => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
}));

/* ---------------- Accounts (investments, savings, cash) ---------------- */

const ACCOUNT_TYPES = ['cash', 'savings', 'brokerage', 'pension', 'crypto', 'other'];

app.get('/api/accounts', route(() => db.prepare(`
  SELECT a.*,
    (SELECT value FROM account_snapshots s WHERE s.account_id = a.id ORDER BY month DESC LIMIT 1) AS latest_value,
    (SELECT month FROM account_snapshots s WHERE s.account_id = a.id ORDER BY month DESC LIMIT 1) AS latest_month,
    (SELECT COALESCE(SUM(contributions), 0) FROM account_snapshots s WHERE s.account_id = a.id) AS total_contributions
  FROM accounts a ORDER BY a.active DESC, a.type, a.name`).all()));

function accountFields(b) {
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'Name is required.');
  return [name, ACCOUNT_TYPES.includes(b.type) ? b.type : 'other', str(b.notes), b.active === false || b.active === 0 ? 0 : 1];
}

app.post('/api/accounts', route(req => {
  const r = db.prepare('INSERT INTO accounts(name, type, notes, active) VALUES(?,?,?,?)').run(...accountFields(req.body));
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/accounts/:id', route(req => {
  db.prepare('UPDATE accounts SET name=?, type=?, notes=?, active=? WHERE id=?').run(...accountFields(req.body), req.params.id);
}));
app.delete('/api/accounts/:id', route(req => { db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id); }));

// Monthly entry grid: every active account with this month's value and the previous known value.
app.get('/api/snapshots', route(req => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  return db.prepare(`
    SELECT a.id AS account_id, a.name, a.type,
      s.value, s.contributions,
      (SELECT value FROM account_snapshots p WHERE p.account_id = a.id AND p.month < ? ORDER BY month DESC LIMIT 1) AS prev_value,
      (SELECT month FROM account_snapshots p WHERE p.account_id = a.id AND p.month < ? ORDER BY month DESC LIMIT 1) AS prev_month
    FROM accounts a LEFT JOIN account_snapshots s ON s.account_id = a.id AND s.month = ?
    WHERE a.active = 1 OR s.id IS NOT NULL
    ORDER BY a.type, a.name`).all(month, month, month);
}));

app.put('/api/snapshots', route(req => {
  const month = req.body.month;
  if (!isMonth(month)) throw new HttpError(400, 'Valid month required.');
  const up = db.prepare(`INSERT INTO account_snapshots(account_id, month, value, contributions) VALUES(?,?,?,?)
    ON CONFLICT(account_id, month) DO UPDATE SET value = excluded.value, contributions = excluded.contributions`);
  const del = db.prepare('DELETE FROM account_snapshots WHERE account_id = ? AND month = ?');
  tx(() => {
    for (const e of req.body.entries || []) {
      const value = num(e.value);
      if (value === null) del.run(e.account_id, month);
      else up.run(e.account_id, month, value, num(e.contributions, 0));
    }
  });
}));

app.get('/api/accounts/:id/history', route(req =>
  db.prepare('SELECT month, value, contributions FROM account_snapshots WHERE account_id = ? ORDER BY month').all(req.params.id)));

/* ---------------- Real estate & vehicles ---------------- */
// Both are an asset valued over time plus a loan (mortgage / car loan) being paid down.

const PROPERTY_COLS = ['name', 'address', 'purchase_date', 'purchase_price', 'ownership_pct', 'lender', 'mortgage_initial',
  'interest_rate', 'monthly_payment', 'mortgage_end', 'monthly_rent', 'notes', 'model', 'year'];
const NUMERIC_PROPERTY_COLS = new Set(['purchase_price', 'ownership_pct', 'mortgage_initial', 'interest_rate', 'monthly_payment', 'monthly_rent', 'year']);
const ASSET_KINDS = ['real_estate', 'vehicle'];

function propertyValues(b) {
  if (!str(b.name)) throw new HttpError(400, 'Name is required.');
  return PROPERTY_COLS.map(c => {
    if (c === 'ownership_pct') return num(b[c], 100);
    return NUMERIC_PROPERTY_COLS.has(c) ? num(b[c]) : str(b[c]);
  });
}

app.get('/api/properties', route(req => {
  const kind = ASSET_KINDS.includes(req.query.kind) ? req.query.kind : 'real_estate';
  return db.prepare(`
    SELECT p.*, s.date AS valuation_date, s.market_value, s.mortgage_balance
    FROM properties p LEFT JOIN property_snapshots s ON s.id = (
      SELECT id FROM property_snapshots WHERE property_id = p.id ORDER BY date DESC, id DESC LIMIT 1)
    WHERE p.kind = ?
    ORDER BY p.name`).all(kind);
}));

app.post('/api/properties', route(req => {
  const b = req.body;
  return tx(() => {
    const kind = ASSET_KINDS.includes(b.kind) ? b.kind : 'real_estate';
    const r = db.prepare(`INSERT INTO properties(kind, ${PROPERTY_COLS.join(',')}) VALUES(?, ${PROPERTY_COLS.map(() => '?').join(',')})`).run(kind, ...propertyValues(b));
    const id = Number(r.lastInsertRowid);
    // Optional initial valuation so the property shows up in net worth immediately.
    const value = num(b.market_value);
    if (value !== null) {
      db.prepare('INSERT INTO property_snapshots(property_id, date, market_value, mortgage_balance) VALUES(?,?,?,?)')
        .run(id, isDate(b.valuation_date) ? b.valuation_date : new Date().toISOString().slice(0, 10), value, num(b.mortgage_balance, 0));
    }
    return { id };
  });
}));

app.put('/api/properties/:id', route(req => {
  db.prepare(`UPDATE properties SET ${PROPERTY_COLS.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...propertyValues(req.body), req.params.id);
}));
app.delete('/api/properties/:id', route(req => { db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id); }));

app.get('/api/properties/:id/snapshots', route(req =>
  db.prepare('SELECT * FROM property_snapshots WHERE property_id = ? ORDER BY date DESC, id DESC').all(req.params.id)));

app.post('/api/properties/:id/snapshots', route(req => {
  const b = req.body;
  if (!isDate(b.date)) throw new HttpError(400, 'Valid date required.');
  const value = num(b.market_value);
  if (value === null) throw new HttpError(400, 'Market value required.');
  db.prepare('INSERT INTO property_snapshots(property_id, date, market_value, mortgage_balance, note) VALUES(?,?,?,?,?)')
    .run(req.params.id, b.date, value, num(b.mortgage_balance, 0), str(b.note));
}));

app.delete('/api/property-snapshots/:id', route(req => { db.prepare('DELETE FROM property_snapshots WHERE id = ?').run(req.params.id); }));

/* ---------------- Reports ---------------- */

// Income/expense per month. Transfer categories (moving money between your own accounts) are excluded.
function monthlyTotals(from, to) {
  return db.prepare(`
    SELECT substr(t.date, 1, 7) AS month,
      SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
      SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE COALESCE(c.kind, 'expense') != 'transfer' AND substr(t.date, 1, 7) BETWEEN ? AND ?
    GROUP BY month ORDER BY month`).all(from, to);
}

app.get('/api/reports/monthly', route(req => {
  const to = isMonth(req.query.to) ? req.query.to : currentMonth();
  const from = isMonth(req.query.from) ? req.query.from : addMonths(to, -11);
  const rows = new Map(monthlyTotals(from, to).map(r => [r.month, r]));
  return monthRange(from, to).map(month => {
    const r = rows.get(month) || { income: 0, expenses: 0 };
    const net = r.income - r.expenses;
    return { month, income: round2(r.income), expenses: round2(r.expenses), net: round2(net), savingsRate: r.income > 0 ? net / r.income : null };
  });
}));

// Net spend per category over a period (refunds into an expense category reduce it).
app.get('/api/reports/categories', route(req => {
  const to = isMonth(req.query.to) ? req.query.to : currentMonth();
  const from = isMonth(req.query.from) ? req.query.from : to;
  return db.prepare(`
    SELECT c.id, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.color, '#b8b8b8') AS color, COALESCE(c.kind, 'expense') AS kind, c."group",
      ROUND(SUM(t.amount), 2) AS total, COUNT(*) AS count
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE substr(t.date, 1, 7) BETWEEN ? AND ?
    GROUP BY c.id ORDER BY total`).all(from, to);
}));

// Category x month matrix of expense spend, for trend charts.
app.get('/api/reports/category-trend', route(req => {
  const to = isMonth(req.query.to) ? req.query.to : currentMonth();
  const from = isMonth(req.query.from) ? req.query.from : addMonths(to, -11);
  const rows = db.prepare(`
    SELECT c.id, c.name, c.color, substr(t.date, 1, 7) AS month, -SUM(t.amount) AS spent
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.kind = 'expense' AND substr(t.date, 1, 7) BETWEEN ? AND ?
    GROUP BY c.id, month`).all(from, to);
  const months = monthRange(from, to);
  const cats = new Map();
  for (const r of rows) {
    if (!cats.has(r.id)) cats.set(r.id, { id: r.id, name: r.name, color: r.color, values: Object.fromEntries(months.map(m => [m, 0])) });
    cats.get(r.id).values[r.month] = round2(r.spent);
  }
  return { months, categories: [...cats.values()] };
}));

// Budget view: spend for the month vs budget vs trailing 6-month average.
app.get('/api/reports/budget', route(req => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const avgFrom = addMonths(month, -6), avgTo = addMonths(month, -1);
  const monthsWithData = db.prepare("SELECT COUNT(DISTINCT substr(date, 1, 7)) AS n FROM transactions WHERE substr(date, 1, 7) BETWEEN ? AND ?").get(avgFrom, avgTo).n || 1;
  return db.prepare(`
    SELECT c.id, c.name, c.color, c.budget, c."group",
      COALESCE((SELECT -SUM(amount) FROM transactions WHERE category_id = c.id AND substr(date, 1, 7) = ?), 0) AS spent,
      COALESCE((SELECT -SUM(amount) FROM transactions WHERE category_id = c.id AND substr(date, 1, 7) BETWEEN ? AND ?), 0) / ? AS avg6
    FROM categories c WHERE c.kind = 'expense'
    ORDER BY c."group", c.name`).all(month, avgFrom, avgTo, monthsWithData)
    .map(r => ({ ...r, spent: round2(r.spent), avg6: round2(r.avg6) }));
}));

// Merchants charged in at least 3 of the last 6 months with a stable amount: likely subscriptions/bills.
app.get('/api/reports/recurring', route(() => {
  const to = currentMonth();
  const from = addMonths(to, -6);
  const rows = db.prepare(`
    SELECT t.concept, t.amount, t.date, c.name AS category_name, c.color
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.amount < 0 AND substr(t.date, 1, 7) >= ? AND COALESCE(c.kind, 'expense') = 'expense'
    ORDER BY t.date`).all(from);
  const groups = new Map();
  for (const r of rows) {
    const key = merchantKey(r.concept);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, concept: r.concept, category_name: r.category_name, color: r.color, months: new Set(), amounts: [], last: r.date });
    const g = groups.get(key);
    g.months.add(r.date.slice(0, 7));
    g.amounts.push(-r.amount);
    g.last = r.date;
    g.concept = r.concept;
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.months.size < 3) continue;
    const avg = g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length;
    const spread = (Math.max(...g.amounts) - Math.min(...g.amounts)) / avg;
    // Roughly one charge per month and similar amounts.
    if (g.amounts.length > g.months.size * 1.5 || spread > 0.35) continue;
    out.push({ concept: g.concept, category_name: g.category_name, color: g.color, monthly: round2(g.amounts.reduce((a, b) => a + b, 0) / g.months.size), occurrences: g.amounts.length, last: g.last });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}));

// Net worth per month: account values carried forward from their last snapshot,
// property values/mortgages from the latest valuation on or before month end.
app.get('/api/reports/networth', route(() => {
  const snaps = db.prepare(`SELECT s.account_id, s.month, s.value, s.contributions, a.type FROM account_snapshots s JOIN accounts a ON a.id = s.account_id ORDER BY s.month`).all();
  const includeVehicleValue = setting('includeVehicleValue', true);
  const props = db.prepare('SELECT ps.*, p.ownership_pct, p.kind FROM property_snapshots ps JOIN properties p ON p.id = ps.property_id ORDER BY ps.date, ps.id').all();
  const firstTx = db.prepare('SELECT MIN(date) AS d FROM transactions').get().d;
  const starts = [snaps[0]?.month, props[0]?.date?.slice(0, 7), firstTx?.slice(0, 7)].filter(Boolean).sort();
  if (!starts.length) return [];
  const months = monthRange(starts[0], currentMonth());

  const accountLatest = new Map(); // account_id -> { value, type }
  const propLatest = new Map();    // property_id -> { value, debt, kind }
  let si = 0, pi = 0;
  return months.map(month => {
    // newlyTracked: value that appears because something started being tracked this month
    // (first snapshot of an account/property/vehicle). It isn't growth, so comparisons subtract it.
    let contributions = 0, hasData = false, newlyTracked = 0;
    while (si < snaps.length && snaps[si].month <= month) {
      const s = snaps[si++];
      if (!accountLatest.has(s.account_id)) newlyTracked += s.value;
      accountLatest.set(s.account_id, { value: s.value, type: s.type });
      if (s.month === month) { contributions += s.contributions; hasData = true; }
    }
    const end = monthEnd(month);
    while (pi < props.length && props[pi].date <= end) {
      const p = props[pi++];
      hasData = true;
      const share = (p.ownership_pct ?? 100) / 100;
      if (!propLatest.has(p.property_id)) {
        const counted = p.kind === 'vehicle' && !includeVehicleValue ? 0 : p.market_value;
        newlyTracked += (counted - p.mortgage_balance) * share;
      }
      propLatest.set(p.property_id, { value: p.market_value * share, debt: p.mortgage_balance * share, kind: p.kind });
    }
    let cash = 0, investments = 0, realEstate = 0, mortgage = 0, vehicles = 0, vehicleLoans = 0;
    for (const a of accountLatest.values()) {
      if (a.type === 'cash' || a.type === 'savings') cash += a.value; else investments += a.value;
    }
    for (const p of propLatest.values()) {
      if (p.kind === 'vehicle') {
        // The loan always counts; the car's resale value only if the user opted in.
        if (includeVehicleValue) vehicles += p.value;
        vehicleLoans += p.debt;
      } else { realEstate += p.value; mortgage += p.debt; }
    }
    return {
      month, cash: round2(cash), investments: round2(investments), realEstate: round2(realEstate), mortgage: round2(mortgage),
      vehicles: round2(vehicles), vehicleLoans: round2(vehicleLoans),
      netWorth: round2(cash + investments + realEstate - mortgage + vehicles - vehicleLoans), contributions: round2(contributions), newlyTracked: round2(newlyTracked), hasData,
    };
  });
}));

// Month-to-date vs a typical month. "Typical" is the average of the previous 6 months
// (months with data), both for the whole month and up to the same day of the month,
// so late salaries and end-of-month bills don't make early days look wrong.
app.get('/api/reports/forecast', route(req => {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const daysInMonth = Number(monthEnd(month).slice(8));
  // We only know about money up to the latest imported bank date (moved transactions use their bank date),
  // so compare "as of" that day rather than the calendar date.
  const today = new Date().toISOString().slice(0, 10);
  const dataUntil = db.prepare('SELECT MAX(COALESCE(original_date, date)) AS d FROM transactions').get().d;
  const cutoff = dataUntil && dataUntil < today ? dataUntil : today;
  const asOfDay = cutoff >= monthEnd(month) ? daysInMonth : cutoff < `${month}-01` ? 0 : Number(cutoff.slice(8, 10));
  const complete = asOfDay >= daysInMonth;
  const from = addMonths(month, -6), to = addMonths(month, -1);

  const history = db.prepare(`
    SELECT t.category_id, substr(t.date, 1, 7) AS m, CAST(substr(t.date, 9, 2) AS INTEGER) AS day, SUM(t.amount) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE substr(t.date, 1, 7) BETWEEN ? AND ? AND COALESCE(c.kind, 'expense') != 'transfer'
    GROUP BY t.category_id, m, day`).all(from, to);
  const histMonths = new Set(history.map(h => h.m));
  const n = histMonths.size || 1;

  const actualRows = db.prepare(`
    SELECT t.category_id, CAST(substr(t.date, 9, 2) AS INTEGER) AS day, SUM(t.amount) AS total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE substr(t.date, 1, 7) = ? AND COALESCE(c.kind, 'expense') != 'transfer'
    GROUP BY t.category_id, day`).all(month);

  const cats = new Map(db.prepare(`SELECT id, name, color, kind, "group" FROM categories WHERE kind != 'transfer'`).all().map(c => [c.id, c]));
  const uncategorized = { id: null, name: 'Uncategorized', color: '#b8b8b8', kind: 'expense', group: 'Other' };
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) rows.set(id, { ...(cats.get(id) || uncategorized), expected: 0, expectedToDate: 0, actual: 0 });
    return rows.get(id);
  };
  // Amounts are flipped to positive for expense categories so "more" always means more spent.
  const sign = id => ((cats.get(id) || uncategorized).kind === 'income' ? 1 : -1);
  const dailyExpected = new Array(daysInMonth + 1).fill(0);
  const dailyActual = new Array(daysInMonth + 1).fill(0);

  for (const h of history) {
    const r = row(h.category_id);
    const v = (h.total * sign(h.category_id)) / n;
    r.expected += v;
    if (complete || h.day <= asOfDay) r.expectedToDate += v;
    if (r.kind === 'expense') dailyExpected[Math.min(h.day, daysInMonth)] += v;
  }
  for (const a of actualRows) {
    const r = row(a.category_id);
    const v = a.total * sign(a.category_id);
    r.actual += v;
    if (r.kind === 'expense') dailyActual[Math.min(a.day, daysInMonth)] += v;
  }

  const categories = [...rows.values()].map(r => ({
    ...r,
    expected: round2(r.expected), expectedToDate: round2(r.expectedToDate), actual: round2(r.actual),
    // Projection: what you have so far plus whatever typically still comes after today.
    projected: round2(r.actual + Math.max(0, r.expected - r.expectedToDate)),
  })).filter(r => r.expected || r.actual);

  const total = kind => {
    const list = categories.filter(c => c.kind === kind);
    const sum = k => round2(list.reduce((a, c) => a + c[k], 0));
    return { expected: sum('expected'), expectedToDate: sum('expectedToDate'), actual: sum('actual'), projected: sum('projected') };
  };
  const cumulative = arr => { let acc = 0; return arr.slice(1).map(v => round2(acc += v)); };

  return {
    month, asOfDay, daysInMonth, dataUntil, historyMonths: histMonths.size,
    income: total('income'), expenses: total('expense'),
    categories,
    cumulative: { expected: cumulative(dailyExpected), actual: cumulative(dailyActual).slice(0, asOfDay) },
  };
}));

/* ---------------- Backup ---------------- */

app.get('/api/export', route((req, res) => {
  const tables = ['settings', 'categories', 'rules', 'imports', 'transactions', 'accounts', 'account_snapshots', 'properties', 'property_snapshots'];
  res.setHeader('Content-Disposition', `attachment; filename="pfinance-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// `--open` (used by the launchers) opens the browser once the server is actually listening.
const URL_ = `http://localhost:${PORT}`;
function openBrowser() {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL_]]
    : process.platform === 'darwin' ? ['open', [URL_]] : ['xdg-open', [URL_]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser available */ }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`PFinance running at ${URL_}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('Keep this window open while you use PFinance; close it to stop.');
  if (process.argv.includes('--open')) openBrowser();
});
server.on('error', err => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Most likely PFinance is already running (launcher double-clicked twice): just show it.
  console.log(`Port ${PORT} is already in use; PFinance is probably already running at ${URL_}.`);
  console.log('If another program uses that port, start PFinance with a different one, e.g. PORT=3001.');
  if (process.argv.includes('--open')) openBrowser();
  process.exitCode = 1;
});
