# BC Ledger Desktop

Minimal tool for fetching:
- client name
- amount
- posting date
- document date
- document number
- amount multiplied by `1.2`
- total amount for the matched records

Current scope is only for G/L account `4092`.

Current flow:
- search by client name
- fetch matching records for G/L account `4092`
- calculate `amount * 1.2` for each row
- calculate totals

This project is now intended to stand on its own outside the main `dashboardbc` repo.

The codebase now supports both:
- a CLI report entrypoint
- a minimal Electron desktop app that uses the same report service

Client search now uses the actual posted document header name:
- `PostedSalesInvoice.Sell_to_Customer_Name`
- `PSCM.Sell_to_Customer_Name`

That avoids the generic ledger customer names like `KLiente te Pergjithshem EURO`.

## Usage

Desktop app:

```bash
npm start
```

Portable Windows build:

```bash
npm run dist
```

Generate embedded config from local `.env`:

```bash
npm run build:config
```

Search by client from this project folder:

```bash
node src/report-4092.js --client "Karallamos"
```

Search by client with a date range:

```bash
node src/report-4092.js --client "PANTEON" --from 2026-01-01 --to 2026-03-31
```

JSON output:

```bash
node src/report-4092.js --client "PANTEON" --json
```

Limit the output after sorting:

```bash
node src/report-4092.js --client "PANTEON" --top 50
```

`--top` only limits the displayed rows. Totals are still calculated from all matched rows.

You can still run the old account/date view without client search:

```bash
node src/report-4092.js --from 2026-01-01 --to 2026-03-31
```

## Data source

- `G_LEntries` for `Posting_Date`, `Document_Date`, `Document_No`, `Amount`
- `PostedSalesInvoice` and `PSCM` for the real sell-to client name
- `Cust_LedgerEntries` as a fallback name source when running the date-only view

The join is done by `Document_No`.

## Environment

The tool reads credentials from the local `.env` file in this folder.

For packaged builds, `npm run build:config` generates `src/generated-embedded-config.js` so the app can run without a separate `.env`.

Required variables:

```env
BC_USERNAME=...
BC_PASSWORD=...
```

Optional variables:

```env
BC_BASE_URL=https://onebs.onetech.al:9956/BC23_BS/ODataV4/Company('BESTSELLER')
BC_LEDGER_ACCOUNT_NO=4092
BC_TIMEOUT_MS=45000
```
