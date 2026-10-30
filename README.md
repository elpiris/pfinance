# PFinance

A personal finance tracker that runs on your own computer. It tracks income and expenses from your bank statements, the monthly value of your investment accounts, your real estate and mortgages, and your overall net worth.

All data is stored locally in `data/finance.db` (SQLite). The server only listens on `127.0.0.1`, so nothing is reachable from outside your machine. Your data is never part of this repository: `data/` is git-ignored.

## Running it

You need Node.js 22.13 or newer.

Double-click `start.bat`, or run:

```
npm install
npm start
```

Then open http://localhost:3000.

## Monthly routine

1. **Import statement.** Drop in the Excel/CSV export from your bank.
   - The header row and the columns (date, concept, amount or debit/credit, balance) are detected automatically, and you can adjust them. The mapping is remembered for that file layout.
   - Optionally link the statement's balance column to a cash account. Its month-end balance then feeds your net worth.
   - Review the suggested categories and fix any of them before importing. Overlapping or repeated statements are de-duplicated.
2. **Investments.** Enter each account's month-end value and, optionally, what you contributed. Contributions are tracked so the app can separate deposits from market growth.
3. **Real estate and vehicles** (whenever you like). Click "Update value / mortgage". The outstanding loan is pre-filled with an estimate based on your rate and monthly payment. For a vehicle, the resale value is also pre-filled assuming about 15% depreciation per year.

Vehicles are a separate line in net worth. Car loans always count as debt. Whether the car's resale value counts as an asset is a toggle in Settings.

## How categorization works

Each transaction is categorized in this order:

1. **Learned.** If you've categorized the same merchant by hand before, that choice is used. Card numbers and reference codes are ignored when matching.
2. **Keyword rules.** There are about 300 built-in keywords for common Spanish and international merchants (Mercadona, Iberdrola, Netflix, Repsol, nómina…). Rules you add yourself take priority over the built-in ones.
3. Otherwise the transaction goes to **Uncategorized** (money out) or **Other income** (money in).

Categories you set by hand are never overwritten by rules.

Categories of type **Transfer**, such as "Transfers" and "Investments", are excluded from income and expense totals. Money moved to your broker therefore doesn't count as spending.

## Pages

- **Dashboard.** Net worth over time (cash, investments and real estate equity), income vs expenses, and the latest month's top categories.
- **This month.** Income and spending so far against a typical month up to the same day, plus a projected month end, overall and per category.
- **Transactions.** Filter, search, re-categorize one at a time or in bulk, add notes and create rules. You can also move a transaction to another month (e.g. a salary paid on the 28th); the bank date is kept.
- **Spending & budget.** Monthly budgets per category, comparison with your 6-month average, a 12-month category heatmap and a detector for recurring charges and subscriptions.
- **Vehicles.** Resale value, car loan, depreciation and payoff progress.
- **Categories & rules.** Manage categories, groups and keyword rules.
- **Settings.** Currency, number format and a JSON backup export.

`samples/extracto-ejemplo.xlsx` is a fake statement you can import to try the app. Delete `data/finance.db` afterwards to start fresh.

## Contributing

- [CLAUDE.md](CLAUDE.md) covers the architecture, domain rules and conventions.
- [TODO.md](TODO.md) lists the roadmap and known issues.
