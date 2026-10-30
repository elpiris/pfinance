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
export function merchantKey(concept) {
  return normalize(concept)
    .replace(/\b(COMPRA|PAGO|TARJ(ETA)?|TARJ\.|CARD|RECIBO|TRANSACCION|OPERACION|EN|DE|CON|PURCHASE|PAYMENT|DEBIT|CREDIT)\b/g, ' ')
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    if (key && learned.has(key) && byId.has(learned.get(key))) {
      return { category_id: learned.get(key), reason: 'learned' };
    }
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
