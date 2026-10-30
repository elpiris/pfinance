# PFinance

A personal finance tracker that runs on your own computer. It tracks income and expenses from your bank statements, the monthly value of your investment accounts, your real estate and mortgages, and your overall net worth.

All data stays on your computer, in a SQLite database in your user's app-data folder, outside the app folder:

| OS | Data folder |
|---|---|
| Windows | `%APPDATA%\PFinance` |
| macOS | `~/Library/Application Support/PFinance` |
| Linux | `~/.local/share/pfinance` |

Updating or deleting the app folder never touches your data, and sharing the app folder never shares it. Settings shows the exact path and has an "Open folder" button.

The server only listens on `127.0.0.1` and rejects requests that don't come from `localhost`, so neither other machines nor websites you visit can reach it.

**Backups.** PFinance makes an automatic backup once a day while it runs and keeps the last 14, in the `backups` subfolder. Settings → **Back up now** creates and downloads a single-file backup to keep somewhere else. To restore, close PFinance, replace `finance.db` with the backup (delete `finance.db-wal` and `finance.db-shm`), and start it again.

Upgrading from a version that stored data in the app's `data` folder: the first start copies it to the new location automatically and leaves the old folder as it was. Delete it once you've checked everything is there.

## Installing and running it

1. **Install Node.js** (version 22.13 or newer). Download the "LTS" installer from https://nodejs.org and run it.
2. **Download PFinance.** On GitHub, click **Code → Download ZIP** and unzip it somewhere permanent, for example your Documents folder.
3. **Start it:**
   - **Windows:** double-click `start.bat`.
   - **macOS:** double-click `start.command`. The first time, macOS will say it can't verify the developer:
     1. Open **System Settings → Privacy & Security**.
     2. Scroll down and click **Open Anyway** next to "start.command".
     3. Double-click it again.
   - **Linux:** run `./start.command` in a terminal.

The first start installs a couple of dependencies, which needs internet. After that the app works offline.

Your browser opens PFinance automatically. A terminal window stays open while the app runs; close it to stop PFinance.

If macOS says `start.command` isn't executable (this can happen with some unzip tools), open Terminal in the folder and run `chmod +x start.command` once.

Developers can also use `npm install` and `npm start`, then open http://localhost:3000.

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
- **Settings.** Currency, number format, data location and backups.

`samples/extracto-ejemplo.xlsx` is a fake statement you can import to try the app. To start fresh afterwards, close PFinance and delete the data folder.

## Contributing

- [CLAUDE.md](CLAUDE.md) covers the architecture, domain rules and conventions.
- [TODO.md](TODO.md) lists the roadmap and known issues.
