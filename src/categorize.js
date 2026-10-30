import { db, normalize } from './db.js';

// Short patterns ("DIA", "BAR", "O2") must match whole words; longer ones only need to start a word,
// so "MCDONALD" matches "MCDONALDS" but "DIA" doesn't match "DIARIO".
function patternRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = pattern.length <= 4 ? '(?![A-Z0-9])' : '';
  return new RegExp(`(?<![A-Z0-9])${escaped}${tail}`);
}

// Strip card numbers, dates, reference codes and filler words so the same merchant
// produces the same key across statements.
const FILLER = new Set(['COMPRA', 'PAGO', 'TARJ', 'TARJETA', 'CARD', 'RECIBO', 'TRANSACCION', 'OPERACION', 'FECHA', 'EN', 'DE', 'CON',
  'PURCHASE', 'PAYMENT', 'DEBIT', 'CREDIT']);
// Company-form suffixes ("SL", "S.A.", "S.L.U.") once punctuation is gone.
const LEGAL_SUFFIX = /( S ?L ?U?| S ?A ?U?)$/;

export function merchantKey(concept) {
  const words = normalize(concept)
    .replace(/\b[A-Z]\d{7,9}[A-Z0-9]?\b/g, ' ') // company tax IDs (CIF/NIF), e.g. B85884534
    .replace(/[^A-Z]+/g, ' ').trim().split(' ')
    .filter(w => w && !FILLER.has(w) && !/^X{3,}$/.test(w)); // masked card numbers
  return words.join(' ').replace(LEGAL_SUFFIX, '').trim();
}

// Different exports of the same bank shorten names differently ("ORA SANTAND" vs "ORA SANTANDER"),
// so a learned key also matches when one is a prefix of the other (at least 6 letters).
function findLearned(learned, key) {
  if (learned.has(key)) return learned.get(key);
  let best = null, bestGap = Infinity;
  for (const [k, cat] of learned) {
    const [short, long] = k.length <= key.length ? [k, key] : [key, k];
    if (short.length < 6 || !long.startsWith(short)) continue;
    const gap = long.length - short.length;
    if (gap < bestGap) { best = cat; bestGap = gap; }
  }
  return best;
}

export function createCategorizer() {
  const categories = db.prepare('SELECT id, name, kind FROM categories').all();
  const byId = new Map(categories.map(c => [c.id, c]));
  const byName = new Map(categories.map(c => [c.name, c]));

  const rules = db.prepare('SELECT pattern, category_id, priority FROM rules').all()
    .map(r => ({ ...r, re: patternRegex(r.pattern) }))
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length);

  // Most recent manual decision per merchant key wins.
  const learned = new Map();
  const manualRows = db.prepare('SELECT concept, category_id FROM transactions WHERE manual = 1 AND category_id IS NOT NULL ORDER BY date, id').all();
  for (const row of manualRows) {
    const key = merchantKey(row.concept);
    if (key) learned.set(key, row.category_id);
  }

  const fallbackExpense = byName.get('Uncategorized')?.id ?? null;
  const fallbackIncome = byName.get('Other income')?.id ?? fallbackExpense;

  return function categorize(concept, amount) {
    const key = merchantKey(concept);
    const learnedCat = key ? findLearned(learned, key) : null;
    if (learnedCat && byId.has(learnedCat)) return { category_id: learnedCat, reason: 'learned' };
    const text = normalize(concept);
    for (const rule of rules) {
      if (!rule.re.test(text)) continue;
      const cat = byId.get(rule.category_id);
      // An income category never applies to money going out.
      if (cat?.kind === 'income' && amount < 0) continue;
      return { category_id: rule.category_id, reason: `rule:${rule.pattern}` };
    }
    return { category_id: amount > 0 ? fallbackIncome : fallbackExpense, reason: 'fallback' };
  };
}
