import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.PFINANCE_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'finance.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- kind: expense | income | transfer (transfers are excluded from income/expense totals)
CREATE TABLE IF NOT EXISTS categories (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  kind    TEXT NOT NULL DEFAULT 'expense',
  color   TEXT NOT NULL DEFAULT '#888888',
  budget  REAL,
  "group" TEXT
);

-- Keyword rules: if the normalized concept contains pattern, assign category.
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'default',  -- default | user
  UNIQUE(pattern)
);

CREATE TABLE IF NOT EXISTS imports (
  id          INTEGER PRIMARY KEY,
  filename    TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  row_count   INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,             -- YYYY-MM-DD
  concept     TEXT NOT NULL,
  amount      REAL NOT NULL,             -- negative = expense, positive = income
  balance     REAL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  manual      INTEGER NOT NULL DEFAULT 0, -- 1 if user set the category by hand
  notes       TEXT,
  import_id   INTEGER REFERENCES imports(id) ON DELETE CASCADE,
  fingerprint TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_cat  ON transactions(category_id);

-- Accounts valued monthly: brokerage, pension, savings, crypto, cash...
CREATE TABLE IF NOT EXISTS accounts (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  type     TEXT NOT NULL DEFAULT 'brokerage',
  currency TEXT,
  notes    TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,           -- YYYY-MM
  value         REAL NOT NULL,
  contributions REAL NOT NULL DEFAULT 0, -- net money added (withdrawals negative) this month
  UNIQUE(account_id, month)
);

CREATE TABLE IF NOT EXISTS properties (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  address          TEXT,
  purchase_date    TEXT,
  purchase_price   REAL,
  ownership_pct    REAL NOT NULL DEFAULT 100,
  lender           TEXT,
  mortgage_initial REAL,
  interest_rate    REAL,
  monthly_payment  REAL,
  mortgage_end     TEXT,
  monthly_rent     REAL,
  notes            TEXT
);

-- Point-in-time valuation + outstanding mortgage. Latest on/before a date is used.
CREATE TABLE IF NOT EXISTS property_snapshots (
  id               INTEGER PRIMARY KEY,
  property_id      INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,        -- YYYY-MM-DD
  market_value     REAL NOT NULL,
  mortgage_balance REAL NOT NULL DEFAULT 0,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_ps_prop ON property_snapshots(property_id, date);
`);

const DEFAULT_CATEGORIES = [
  // name, kind, color, group
  ['Salary', 'income', '#2e9d5b', 'Income'],
  ['Other income', 'income', '#6cc08b', 'Income'],
  ['Refunds', 'income', '#9ad4ad', 'Income'],
  ['Rent / Mortgage', 'expense', '#3a6ea5', 'Housing'],
  ['Utilities', 'expense', '#5b8fc7', 'Bills'],
  ['Phone & Internet', 'expense', '#7aa6d6', 'Bills'],
  ['Insurance', 'expense', '#4b5d8a', 'Bills'],
  ['Subscriptions', 'expense', '#8e5bd1', 'Bills'],
  ['Groceries', 'expense', '#e39b2d', 'Living'],
  ['Restaurants & Bars', 'expense', '#e0672f', 'Lifestyle'],
  ['Fuel', 'expense', '#c94c4c', 'Transport'],
  ['Transport', 'expense', '#d97a7a', 'Transport'],
  ['Car', 'expense', '#a33a3a', 'Transport'],
  ['Shopping', 'expense', '#d1528e', 'Lifestyle'],
  ['Health', 'expense', '#3aa6a0', 'Living'],
  ['Sports & Fitness', 'expense', '#55b8b3', 'Lifestyle'],
  ['Travel', 'expense', '#e8b83a', 'Lifestyle'],
  ['Entertainment', 'expense', '#b06cd8', 'Lifestyle'],
  ['Education', 'expense', '#6c7fd8', 'Living'],
  ['Home', 'expense', '#8a7a5a', 'Housing'],
  ['Taxes & Fees', 'expense', '#6b6b6b', 'Bills'],
  ['Cash withdrawal', 'expense', '#9a9a9a', 'Other'],
  ['Gifts & Donations', 'expense', '#c78fb3', 'Lifestyle'],
  ['Uncategorized', 'expense', '#b8b8b8', 'Other'],
  ['Transfers', 'transfer', '#7f8c8d', 'Transfers'],
  ['Investments', 'transfer', '#16a085', 'Transfers'],
];

// Keywords matched against the upper-cased, accent-stripped concept.
const DEFAULT_RULES = {
  'Salary': ['NOMINA', 'NÓMINA', 'SALARY', 'PAYROLL', 'SUELDO'],
  'Refunds': ['DEVOLUCION', 'REEMBOLSO', 'REFUND', 'ABONO COMPRA'],
  'Rent / Mortgage': ['ALQUILER', 'HIPOTECA', 'PRESTAMO HIPOT', 'MORTGAGE', 'RENT PAYMENT'],
  'Utilities': ['IBERDROLA', 'ENDESA', 'NATURGY', 'REPSOL LUZ', 'HOLALUZ', 'TOTALENERGIES', 'CANAL DE ISABEL', 'AGUAS', 'GAS NATURAL', 'ELECTRIC', 'WATER BILL'],
  'Phone & Internet': ['MOVISTAR', 'VODAFONE', 'ORANGE', 'DIGI', 'JAZZTEL', 'MASMOVIL', 'YOIGO', 'PEPEPHONE', 'O2', 'LOWI', 'SIMYO', 'FINETWORK'],
  'Insurance': ['SEGURO', 'MAPFRE', 'MUTUA', 'SANITAS', 'ADESLAS', 'AXA', 'ALLIANZ', 'LINEA DIRECTA', 'GENERALI', 'DKV', 'INSURANCE'],
  'Subscriptions': ['NETFLIX', 'SPOTIFY', 'HBO', 'DISNEY', 'AMAZON PRIME', 'PRIME VIDEO', 'APPLE.COM', 'ITUNES', 'GOOGLE STORAGE', 'GOOGLE ONE', 'YOUTUBE', 'DAZN', 'MOVISTAR PLUS', 'ICLOUD', 'DROPBOX', 'MICROSOFT', 'ADOBE', 'CHATGPT', 'OPENAI', 'ANTHROPIC', 'CLAUDE.AI', 'PATREON', 'AUDIBLE', 'KINDLE', 'FILMIN', 'CRUNCHYROLL', 'TWITCH', 'PLAYSTATION', 'XBOX', 'NINTENDO'],
  'Groceries': ['MERCADONA', 'CARREFOUR', 'LIDL', 'ALDI', 'DIA', 'EROSKI', 'ALCAMPO', 'HIPERCOR', 'SUPERCOR', 'CONSUM', 'BM SUPERMERCADO', 'AHORRAMAS', 'SUPERMERCADO', 'GADIS', 'FROIZ', 'BONPREU', 'CONDIS', 'CAPRABO', 'SPAR', 'COVIRAN', 'FRUTERIA', 'CARNICERIA', 'PANADERIA', 'GROCERY'],
  'Restaurants & Bars': ['RESTAURANTE', 'REST', 'BAR', 'CAFETERIA', 'CAFE', 'GLOVO', 'JUST EAT', 'UBER EATS', 'DELIVEROO', 'TELEPIZZA', 'DOMINOS', 'MCDONALD', 'BURGER KING', 'KFC', 'STARBUCKS', 'TAPAS', 'CERVECERIA', 'TABERNA', 'PIZZERIA', 'RESTAURANT'],
  'Fuel': ['REPSOL', 'CEPSA', 'GALP', 'BP', 'SHELL', 'PETRONOR', 'PLENOIL', 'BALLENOIL', 'GASOLINERA', 'ESTACION DE SERVICIO', 'E.S.', 'CARBURANTE', 'PETROL', 'FUEL'],
  'Transport': ['RENFE', 'METRO', 'EMT', 'CABIFY', 'UBER', 'BOLT', 'FREENOW', 'TAXI', 'BLABLACAR', 'IRYO', 'OUIGO', 'ALSA', 'TMB', 'BUS', 'PARKING', 'APARCAMIENTO', 'TELPARK', 'AUTOPISTA', 'PEAJE', 'VIA-T'],
  'Car': ['ITV', 'TALLER', 'NEUMATICO', 'NORAUTO', 'MIDAS', 'FEU VERT', 'DGT', 'LAVADO'],
  'Shopping': ['AMAZON', 'AMZN', 'ZARA', 'PRIMARK', 'H&M', 'EL CORTE INGLES', 'MANGO', 'PULL&BEAR', 'BERSHKA', 'DECATHLON', 'IKEA', 'MEDIA MARKT', 'MEDIAMARKT', 'FNAC', 'PCCOMPONENTES', 'ALIEXPRESS', 'SHEIN', 'WALLAPOP', 'VINTED', 'LEROY MERLIN', 'BRICOMART', 'PAYPAL'],
  'Health': ['FARMACIA', 'PHARMACY', 'CLINICA', 'DENTAL', 'DENTISTA', 'HOSPITAL', 'OPTICA', 'MEDICO', 'FISIO', 'QUIRON', 'VITHAS', 'HM HOSPITALES'],
  'Sports & Fitness': ['GIMNASIO', 'GYM', 'BASIC FIT', 'BASIC-FIT', 'ALTAFIT', 'MCFIT', 'DREAMFIT', 'VIVAGYM', 'CROSSFIT', 'PADEL', 'PLAYTOMIC'],
  'Travel': ['RYANAIR', 'VUELING', 'IBERIA', 'EASYJET', 'AIR EUROPA', 'BOOKING', 'AIRBNB', 'HOTEL', 'EXPEDIA', 'EDREAMS', 'HOSTEL', 'AENA', 'AEROPUERTO'],
  'Entertainment': ['CINE', 'CINESA', 'YELMO', 'TEATRO', 'TICKETMASTER', 'ENTRADAS', 'MUSEO', 'CONCIERTO', 'STEAM'],
  'Education': ['UNIVERSIDAD', 'ACADEMIA', 'COLEGIO', 'UDEMY', 'COURSERA', 'MATRICULA', 'LIBRERIA', 'CASA DEL LIBRO'],
  'Home': ['COMUNIDAD PROP', 'COMUNIDAD DE PROPIETARIOS', 'LIMPIEZA', 'FERRETERIA', 'MUEBLES'],
  'Taxes & Fees': ['AEAT', 'AGENCIA TRIBUTARIA', 'HACIENDA', 'IMPUESTO', 'IBI', 'AYUNTAMIENTO', 'COMISION', 'COMISIÓN', 'TASA', 'SEG SOCIAL', 'SEGURIDAD SOCIAL', 'TGSS', 'MULTA', 'INTERESES DEUDORES', 'FEE'],
  'Cash withdrawal': ['CAJERO', 'RETIRADA EFECTIVO', 'REINTEGRO', 'DISPOSICION EFECTIVO', 'ATM', 'CASH WITHDRAWAL'],
  'Gifts & Donations': ['DONACION', 'ONG', 'CRUZ ROJA', 'UNICEF', 'CARITAS', 'REGALO'],
  'Investments': ['INDEXA', 'MYINVESTOR', 'TRADE REPUBLIC', 'DEGIRO', 'INTERACTIVE BROKERS', 'FINIZENS', 'BINANCE', 'COINBASE', 'KRAKEN', 'FONDO', 'PLAN PENSIONES', 'BROKER', 'APORTACION'],
  'Transfers': ['TRASPASO', 'TRANSFERENCIA A FAVOR DE', 'TRANSFERENCIA INTERNA', 'TRANSFER TO', 'REVOLUT', 'WISE'],
};

export function setting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed() {
  if (setting('seeded')) return;
  tx(() => {
    const insCat = db.prepare('INSERT OR IGNORE INTO categories(name, kind, color, "group") VALUES(?, ?, ?, ?)');
    for (const c of DEFAULT_CATEGORIES) insCat.run(...c);
    const catId = db.prepare('SELECT id FROM categories WHERE name = ?');
    const insRule = db.prepare('INSERT OR IGNORE INTO rules(pattern, category_id, priority, source) VALUES(?, ?, 0, \'default\')');
    for (const [cat, patterns] of Object.entries(DEFAULT_RULES)) {
      const { id } = catId.get(cat);
      for (const p of patterns) insRule.run(normalize(p), id);
    }
    setSetting('currency', 'EUR');
    setSetting('locale', 'es-ES');
    setSetting('seeded', true);
  });
}

// Upper-case, strip accents and collapse whitespace so rules match regardless of formatting.
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Schema/data changes for databases created by earlier versions. Each step runs once.
function migrate() {
  const version = setting('schemaVersion', 1);
  if (version < 2) {
    tx(() => {
      // Vehicles share the properties table: a value over time plus a loan being paid down.
      const cols = db.prepare('PRAGMA table_info(properties)').all().map(c => c.name);
      if (!cols.includes('kind')) db.exec("ALTER TABLE properties ADD COLUMN kind TEXT NOT NULL DEFAULT 'real_estate'");
      if (!cols.includes('model')) db.exec('ALTER TABLE properties ADD COLUMN model TEXT');
      if (!cols.includes('year')) db.exec('ALTER TABLE properties ADD COLUMN year INTEGER');
      db.prepare('INSERT OR IGNORE INTO categories(name, kind, color, "group") VALUES(?, ?, ?, ?)').run('Car loan', 'expense', '#7a2e2e', 'Transport');
      const { id } = db.prepare("SELECT id FROM categories WHERE name = 'Car loan'").get();
      const insRule = db.prepare("INSERT OR IGNORE INTO rules(pattern, category_id, priority, source) VALUES(?, ?, 0, 'default')");
      for (const p of ['PRESTAMO COCHE', 'PRESTAMO VEHICULO', 'PRESTAMO AUTO', 'FINANCIACION VEHICULO', 'FINANCIACION COCHE', 'CAR LOAN', 'AUTO LOAN',
        'SANTANDER CONSUMER', 'CONSUMER FINANCE', 'CETELEM', 'FCA CAPITAL', 'CA AUTO BANK', 'RCI BANQUE', 'MOBILIZE FINANCIAL', 'VOLKSWAGEN BANK', 'VOLKSWAGEN FINANCIAL',
        'TOYOTA KREDITBANK', 'BMW BANK', 'MERCEDES-BENZ FINANCIAL', 'STELLANTIS FINANCIAL', 'PSA FINANCIAL', 'HYUNDAI CAPITAL', 'KIA FINANCE', 'BBVA CONSUMER']) {
        insRule.run(normalize(p), id);
      }
      setSetting('includeVehicleValue', true);
      setSetting('schemaVersion', 2);
    });
  }
  if (version < 3) {
    tx(() => {
      // `date` is the date used for reporting; when the user moves a transaction to another
      // month, the bank's date is kept here. The import fingerprint keeps using the bank date.
      const cols = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
      if (!cols.includes('original_date')) db.exec('ALTER TABLE transactions ADD COLUMN original_date TEXT');
      setSetting('schemaVersion', 3);
    });
  }
  if (version < 4) {
    tx(() => {
      // Short concepts used by CaixaBank's CSV export ("SANTANDER CONSUM.").
      const catId = name => db.prepare('SELECT id FROM categories WHERE name = ?').get(name)?.id;
      const insRule = db.prepare("INSERT OR IGNORE INTO rules(pattern, category_id, priority, source) VALUES(?, ?, 0, 'default')");
      if (catId('Car loan')) insRule.run('SANTANDER CONSUM', catId('Car loan'));
      if (catId('Subscriptions')) for (const p of ['NETLIFY', 'VERCEL', 'GITHUB']) insRule.run(p, catId('Subscriptions'));
      setSetting('schemaVersion', 4);
    });
  }
}

seed();
migrate();
