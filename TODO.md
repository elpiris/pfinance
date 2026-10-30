# TODO

Ideas and known issues, roughly in priority order. Move items to "Done" (with the date) as they land.

## Known issues

- [ ] **Bizum is income/expense with no category.** Consider a dedicated "Bizum" category with rules for both directions, so they're easy to review in bulk.
- [ ] **Recurring detector misses variable bills.** Utilities that vary more than 35% month to month aren't listed. Use a looser tolerance for Utilities/Phone categories, or a median-based check.

## Next up

- [ ] **Tests.** Use `node:test` with a temp `PFINANCE_DATA` and cover:
  - `parseAmount` (Spanish/English formats, parentheses, trailing minus) and `parseDate` (serials, DMY/MDY)
  - `merchantKey`, rule matching boundaries, and fingerprint dedupe
  - networth carry-forward and the vehicle toggle
  - migrations from schema v1
- [ ] **Multiple bank accounts and cards.** Link each transaction to a source account (current account, credit card…). The import picks the account. This enables per-account balances and detecting transfers between your own accounts, which would then be auto-categorized as Transfers.
- [ ] **Restore from the app.** Pick a backup (or a JSON export) in Settings and restore it, instead of swapping files by hand.
- [ ] **Loan details.** For mortgages and car loans:
  - an amortization schedule
  - the interest vs principal split of each payment
  - total interest left to pay
  - "what if I prepay X" (how many months or how much interest saved)
- [ ] **Link loan payments to the asset.** Choose the category or keyword whose payments belong to a loan, then show actual payments next to the expected schedule.

## Spending insights

- [ ] **"Always ask" merchants.** For cash withdrawals (`REINT.CAJERO`) and generic transfers, the purpose varies each time, so "learned = most recent manual choice" guesses wrong. Let the user mark a merchant as "always ask": no learned category, and it's highlighted in the import preview.
- [ ] **Split a transaction** across several categories (e.g. a supermarket receipt that is part groceries, part home).
- [ ] **Annual / irregular expenses.** For bills like IBI, car insurance and ITV: a yearly budget spread across months ("sinking funds") and reminders of upcoming ones.
- [ ] **Year view.** Totals per category per year, comparing year on year.
- [ ] **Savings opportunities page.** Subscriptions you could cancel, categories trending up 3 months in a row, and average ticket per merchant.
- [ ] **Tags** (e.g. "Vacation Italy 2026") that cut across categories.
- [ ] **CSV/Excel export** of filtered transactions.

## Investments & net worth

- [ ] **Return metrics.** Money-weighted (XIRR) and time-weighted returns per account and overall, using contributions.
- [ ] **Auto-suggest contributions.** Fill each month's contribution from transactions in the "Investments" category.
- [ ] **Asset allocation** (equity / bonds / cash / real estate) and a target vs actual comparison.
- [ ] **Goals and projections.** Net-worth or FIRE target with a projection from the current savings rate and an assumed return.
- [ ] **"Liquid net worth"** KPI, excluding real estate and vehicles.

## App & sharing

- [ ] **Setup docs for other users.** Requirements, first run, and how to add rules for their bank. Consider shipping a few bank import presets (Santander, BBVA, CaixaBank, ING, Sabadell…).
- [ ] **Spanish UI (i18n).** Move strings to a dictionary and add a language setting.
- [ ] **Docker image / single-file build** so non-developers can run it.
- [ ] **Theme toggle.** Light/dark/system; the CSS already supports `data-theme`.
- [ ] **Mobile layout pass.** The tables on Transactions and Budget are cramped on phones.
- [ ] **Authentication.** Only needed if the app ever listens beyond `127.0.0.1` (e.g. on a home server). It must not be exposed without it; the Host check (`PFINANCE_ALLOWED_HOSTS`) is not a substitute.
- [ ] **Dependency note.** `xlsx` (SheetJS) is installed from the SheetJS CDN tarball, because the npm registry copy is outdated. Keep it pinned and update deliberately.

## Done

- 2026-10-15: First version (import, categorization, budget, investments, real estate, dashboard).
- 2026-10-30: Import dropzone layout fix; vehicles + car loans with net worth toggle; no-cache static files; GitHub repo, CLAUDE.md, TODO.md, MIT license.
- 2026-10-30: Split balance columns (`Saldo (+)` / `Saldo (-)`) in import, auto-detected and also applied to saved layouts. Newly tracked accounts/properties/vehicles are no longer counted as net-worth growth. The importer no longer guesses date columns like "F. Valor" as the amount.
- 2026-10-30: Move a transaction to another date/month (bank date kept, dedupe unaffected). New "This month" page: month-to-date vs typical-by-the-same-day (last 6 months), projected month end per category, and a dashboard card. The cutoff is the latest imported bank date.
- 2026-10-30: CSV import (CaixaBank format: `;`-separated, `-800,00EUR`), with separator and encoding detection. Cross-format duplicate detection (amount + running balance ±3 days). Merchant matching across export formats (prefixes, tax IDs, SL/SA).
- 2026-10-30: Data moved to the per-user app-data folder (copied automatically from `<app>/data`, which is left untouched). Daily automatic backups (keep 14), "Back up now" with download, WAL checkpoint every 5 min and on exit. Host/Origin check against DNS rebinding and cross-site requests. macOS/Linux launcher.
