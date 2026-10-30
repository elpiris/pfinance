# CLAUDE.md

Guidance for Claude Code (and humans) working on PFinance, a local-first personal finance tracker.

## Stack & layout

- **Backend:** Node.js ≥ 22.13, Express 4, SQLite via the built-in `node:sqlite` (`DatabaseSync`). There is no ORM and no build step.
- **Frontend:** vanilla ES modules, no framework or bundler. Chart.js and SheetJS are served from `node_modules` under `/vendor/*`.
- **Data:** a single SQLite file, `data/finance.db` (git-ignored). Set `PFINANCE_DATA=<dir>` to use a different folder.

```
server.js              API routes (settings, categories/rules, import, transactions, accounts, properties, reports, export)
src/db.js              schema, default categories + keyword rules, seed(), migrate(), helpers (setting, tx, normalize)
src/categorize.js      categorization engine: learned merchant → keyword rules → fallback
public/index.html      shell + sidebar nav
public/css/app.css     all styles; design tokens as CSS variables (light + dark)
public/js/main.js      hash router (#/route?query)
public/js/util.js      api(), money/date formatting, modal/toast, chart() wrapper, categoryOptions()
public/js/views/*.js   one module per page; each exports an async (root, params) => void renderer
samples/               fake bank statement for testing imports
```

## Commands

```
npm install
npm start            # http://127.0.0.1:3000
npm run dev          # node --watch
```

To test without touching real data, run a throwaway instance:

```
PORT=3999 PFINANCE_DATA="$TEMP/pftest" node server.js
```

Never run experiments against `data/finance.db`. Importing `src/db.js` (directly or via `categorize.js`/`server.js`) opens the real DB and runs migrations, so use `node --check <file>` for syntax checks. To test a migration on real data, copy the DB, together with its `-wal` and `-shm` files, into a temp dir first.

## Domain rules (don't break these)

- **Amounts are signed:** negative is money out, positive is money in. Dates are `YYYY-MM-DD` and months are `YYYY-MM`, both stored as TEXT.
- **Category kinds** are `expense`, `income` and `transfer`. Transfer categories, such as moving money between your own accounts or into a broker, are excluded from every income/expense total.
- **Manual categorization always wins.** `transactions.manual = 1` means the user chose the category, and rule re-application (`reapplyRules`) must never touch those rows.
- **Categorization order** (`createCategorizer`):
  1. Learned: the most recent manual category for the same `merchantKey`. Card numbers, digits and filler words are stripped.
  2. Keyword rules, sorted by priority (user = 10, default = 0) and then by pattern length.
  3. Fallback: Uncategorized, or Other income for money in.
- **Keyword patterns** are matched against `normalize(concept)`, which upper-cases the text and strips accents. Patterns of 4 characters or fewer must match a whole word. Longer patterns only need to start a word. The bank sometimes glues prefixes onto names (e.g. `CORESANTANDER`), so prefer a distinctive later word as the pattern.
- **Import dedupe** (`duplicateChecker` in server.js). A row counts as already imported if either test matches:
  - Its fingerprint (`date|amount|normalized concept|occurrence#`) matches. The occurrence number keeps genuine same-day repeats.
  - Same amount and same running balance within ±3 days, in a *different* import. This catches the same account exported in another format (e.g. CaixaBank XLS vs CSV), where the concept text differs.
- **CSV files** are parsed by `parseCsv` in import.js, not by SheetJS, which reads 05/10 as May 10. It detects the separator (`;`, `,`, tab, `|`) and decodes UTF-8 with a Windows-1252 fallback.
- **`merchantKey`** drops filler words (COMPRA, FECHA, OPERACION…), masked card numbers, company tax IDs and SL/SA suffixes. Learned categories also match when one key is a prefix (6 or more letters) of the other.
- **Net worth** (`/api/reports/networth`):
  - Account snapshots are carried forward month to month.
  - For properties and vehicles, the latest snapshot on or before month end is used, scaled by `ownership_pct`.
  - Vehicle *value* counts only when the `includeVehicleValue` setting is on. Vehicle *loans* always count.
- **Properties and vehicles share the `properties` table**, told apart by `kind` (`real_estate` | `vehicle`). Values and loan balances over time live in `property_snapshots`. The column `mortgage_*` means "loan" for both kinds.

## Schema changes

- `seed()` runs once, on a fresh DB.
- Changes for existing users go in `migrate()` in `src/db.js` as a new `if (version < N)` block that ends with `setSetting('schemaVersion', N)`.
- New default rules or categories also need a migration, because `seed()` will not re-run for existing databases.
- Migrations must be additive: `ALTER TABLE ADD COLUMN`, `INSERT OR IGNORE`.

## Frontend conventions

- Views build HTML with template strings. **Always pass user/bank data through `esc()`.**
- Wrap event handlers in `guard()` so errors show as a toast.
- Use `api()` for requests, and `money()`, `dateLabel()` and `monthLabel()` for formatting. Formatting respects the `currency` and `locale` settings, which default to EUR and es-ES.
- Use `modal()` and `confirmDialog()` for dialogs, never `alert()`.
- Charts go through `chart()` in `util.js`, which applies theme colors and tooltips. Call `destroyCharts()` on route change; the router already does this.
- **Colors:**
  - Chart series use the validated categorical palette `--series-1..4` in fixed order: blue, orange, aqua, yellow.
  - Magnitudes use the single-hue ramp `--seq-0..6`.
  - Don't invent new chart colors. Don't color charts by the 25+ category colors; those are only identity dots next to text.
  - Status colors (`--good`, `--critical`, `--warning`) are only for good/bad state.
- Every token has a dark-mode value. If you add a token, define it in all three places in `app.css`: `:root`, the `prefers-color-scheme` block and `[data-theme="dark"]`.
- Static files are served with `Cache-Control: no-cache`. Server code changes need a restart; page files don't.

## Windows gotchas (dev machine is Spanish Windows)

- To stop a test server, identify it with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, which shows the PID, start time and command line, then run `Stop-Process -Id <pid>`.
  - The user's instance shows up as `node  server.js` (from start.bat). Test servers started from Bash show the full `C:\Program Files\nodejs\node.exe server.js` path.
  - Port lookups are unreliable here: `Get-NetTCPConnection` has returned PID 0 (Idle), and `netstat` sometimes omits the listening line.
  - Kill exactly one PID. Never kill every `node.exe`, because the user's own instance runs on port 3000 and its PID changes on every restart.
  - Delete the temp DB only after the process holding it has exited.
- In ESM, absolute Windows import paths need `file:///C:/...`.
- Don't write JS containing regex escapes (`\b`, `\d`, `\u`) through Python or `node -e` string literals in Bash. `\b` became a literal backspace and `\uFEFF` a literal BOM. Use the Edit tool, then check with `grep -nP "[\x00-\x08]"`.
