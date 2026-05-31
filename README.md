# Models.dev Explorer

Live Next.js table explorer for the [models.dev API](https://models.dev/api.json).

## Features

- Fetches `https://models.dev/api.json` at runtime through a no-cache Next.js route.
- Flattens the provider and model records into one row per model.
- Generates table columns from every live leaf field in the payload.
- Supports full-text search, per-column filtering, per-column sorting, and pagination.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run lint
npm run build
```

## Data Source

This app does not store a static copy of the catalog. The browser loads `/api/models`, and that route fetches the current response from `https://models.dev/api.json` with `cache: "no-store"` and `Cache-Control: no-store`.
