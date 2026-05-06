# aXount: Grant Ledger

Local-first grant reconciliation for K-12 finance teams.

Grant Ledger imports an approved budget workbook, account-budget workbook, and invoice/purchase workbook, then helps users compare what was approved, what was spent, what needs review, and what remains. It is designed to run locally with no hosted database or domain.

## Current Features

- Import approved budget, account summary, and invoice detail workbooks.
- Match purchases to specific approved budget lines where possible.
- Force weak function/object-only matches into human review.
- Track confirmed, not allowable, partially allowable, and review-required items.
- Mark budget lines that are over budget, with 10% detail kept in advanced views.
- Pinpoint approved-budget vs account-budget setup gaps.
- Save/reopen local `.recon` project files.
- Autosave the latest local browser draft.
- Export an Excel reconciliation workbook.
- Tauri desktop shell scaffold for Mac, Windows, and Linux packaging.

## Development

```bash
npm ci --ignore-scripts
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Run checks:

```bash
npm test
npm run build
cd src-tauri && cargo check
```

## Data Safety

Do not commit district workbooks or saved project files. The repository ignores workbook files and `.recon` project bundles by default.

Tests use synthetic fixture data that preserves the reconciliation scenarios without publishing real district source files.
