# allowance-ledger

A mobile-first allowance tracker with:

- Static Web App frontend
- Azure Functions API backend (hosted with Static Web Apps)
- Azure Blob Storage JSON ledger persistence

## Features

- iPhone-optimized UI for Logan and Quinn balances
- Per-child transaction list with create, update, and delete actions
- Weekly recurring $5 credit (manual trigger endpoint + scheduled timer function)
- Blob-backed ledger model (JSON)

## Architecture

- Frontend: `web/` static site files (`web/index.html`, `web/styles.css`, `web/app.js`)
- API: `api/` Azure Functions (Node.js v4 programming model)
- Data: blob `ledger/ledger.json`

Primary API routes:

- `GET /api/ledger`
- `GET /api/ledger/{child}`
- `POST /api/transactions`
- `PUT /api/transactions/{id}`
- `DELETE /api/transactions/{id}?child=Logan|Quinn`
- `POST /api/weekly-credit/apply`

Scheduled function:

- `weeklyCreditScheduler` (every Monday at 12:00 UTC)

## Run locally

```bash
npm start
```

Then open `http://localhost:4173`.

Install and run Functions locally:

```bash
npm run api:install
npm run api:start
```

Copy `api/local.settings.sample.json` to `api/local.settings.json` and set storage values.

## Azure deployment

This repo includes:

- `azure.yaml` for azd
- `infra/main.bicep` for Static Web App and Storage (with API app settings)

Deploy steps:

```bash
az login
azd auth login
azd init
azd up
```

After deployment:

1. Open Static Web App URL
2. Leave API base URL blank (defaults to `/api`) or set a custom endpoint
3. Use the app to manage transactions and totals

## Test

```bash
npm test
```
