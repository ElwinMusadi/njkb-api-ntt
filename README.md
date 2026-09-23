# NJKB API NTT — Phase 7

Cloudflare Workers + Hono API backed by a provenance-aware D1 reference database,
a BPAD vehicle adapter, a deterministic vehicle-year resolver, and a validated
JSON/CSV ingestion pipeline. Tests never call the live BPAD endpoint.

Phase 5 changed lookup semantics: the public endpoint no longer accepts `tax_year`.
Phase 6 activates the full regulatory resolution model:

- `vehicle_year <= 2025` → **Pergub NTT No. 26 Tahun 2025** (approved, provincial)
- `vehicle_year = 2026`  → **Permendagri No. 11 Tahun 2026** (approved, national)

No cross-tier fallback. No cross-year substitution. No automatic code alias.

## Run locally

Node.js 22+ is required.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
```

Vitest creates isolated Miniflare D1 databases, applies the same migrations, loads
the required fixtures, and disposes each database. For a local HTTP smoke test with
mock BPAD and disposable D1, use two terminals:

```sh
npm run dev:mock-bpad
npm run dev:fixture
```

Then call:

```sh
curl -i "http://127.0.0.1:8787/api/njkb/DH4786PD"
curl -i "http://127.0.0.1:8787/api/njkb/DH2025AA"
curl -i "http://127.0.0.1:8787/api/njkb/DH2026ZZ"
```

The 2024 and 2025 samples resolve from the Pergub NTT 26/2025 edition. The 2026
sample resolves from the Permendagri 11/2026 edition. Supplying `?tax_year=...`
returns `400 unsupported_query_parameter`.

## Public endpoint

```text
GET /api/njkb/{nopol}
GET /health
GET /ready
```

`/health` adalah liveness probe tanpa dependency eksternal. `/ready` menjalankan satu
query D1 ringan. Lookup publik dilindungi fixed-window safeguard per Worker isolate;
Cloudflare WAF Rate Limiting tetap diperlukan untuk limit global pada deployment.

```text
GET /api/njkb/{nopol}
```

The route validates NOPOL, calls BPAD with a configurable timeout, normalizes only
the six matching attributes, resolves an exact vehicle-year reference, and maps the
result to a stable public contract. Money and weight are decimal strings.

Responses use `Cache-Control: no-store`; CORS remains disabled. Owner, address,
identity, chassis, engine, and contact data are not persisted, exposed, or logged.
See `docs/api.md`.

## Resolution model

The regulatory boundary is a final Phase 6 decision:

- `vehicle_year <= 2025` → Pergub NTT 26/2025 (provincial, jurisdiction=NTT)
- `vehicle_year = 2026`  → Permendagri 11/2026 (national, jurisdiction=ID)

No cross-tier fallback is permitted. A 2024 vehicle must not resolve from the
national 2026 edition, and a 2026 vehicle must not resolve from the provincial
edition, even when the identity matches.

For each applicable authority tier, the engine requires verified coverage for the
exact vehicle year and category, then applies:

1. exact full source code + vehicle year;
2. exact normalized brand + type + vehicle year + category;
3. an explicitly verified code mapping;
4. fuzzy candidates for human review only.

No value is substituted across years, estimated, interpolated, or derived from a
similar code. `701167 08549` and `701167 67749` remain independent.

## Regulatory editions

| Edition | Regulation | Jurisdiction | applicability_status | Vehicle year scope |
|---|---|---|---|---|
| edition-2025 | Pergub NTT 26/2025 | NTT | approved | ≤ 2025 |
| edition-2026 | Permendagri 11/2026 | ID | approved | 2026 |

See `docs/phase5-regulatory-resolution-report.md` for the regulatory evidence,
`docs/phase6-regulatory-resolution.md` for the final authority boundary,
`docs/phase7-extraction.md` for the Phase 7A baseline,
`docs/phase7c-final-resolution.md` for final data reconciliation, and
`docs/production-operations.md` for production operations, recovery, and smoke tests.

## Full dataset status

Phase 7 keeps verified fixtures separate from generated full canonical datasets.
Pergub uses deterministic PDF table extraction; Permendagri uses a pinned OCR JSONL
asset because the official PDF pages are scanned. Every rejected/ambiguous row is
listed in an extraction QA artifact. Phase 7C resolves the Phase 7B backlog: Pergub
rows 92–191 are a physically verified `SOURCE_NUMBERING_GAP`, and every residual
Permendagri position has a source-backed terminal disposition. Final local D1 contains
64,874 active references and zero unresolved source positions.

Local Phase 7 workflow uses a fresh migrated database without `npm run db:seed`:

```sh
npm run db:migrate
npm run import:njkb -- fixtures/canonical/pergub-ntt-26-2025.full.json
npm run import:njkb -- fixtures/canonical/permendagri-11-2026.full.json
npm run phase7:verify:local -- fixtures/canonical/pergub-ntt-26-2025.full.json fixtures/canonical/permendagri-11-2026.full.json
```

## Canonical ingestion

The Phase 4 pipeline remains unchanged:

```sh
npm run import:njkb -- path/to/dataset.json
npm run import:njkb -- path/to/dataset.csv --report path/to/report.json
```

For CSV, use a sibling `dataset.csv.manifest.json`. The pipeline performs
normalization, validation, duplicate analysis, immutable provenance, idempotency,
and batched D1 insertion. Raw source values are retained; money is integer rupiah
and weight is fixed-point micros. It never performs fuzzy matching or automatic
correction. See `docs/ingestion.md`.

## Project structure

```text
njkb-api-ntt/
  wrangler.jsonc
  package.json
  migrations/
    0001_reference_database.sql
    0002_additional_provenance_checks.sql
    0003_ingestion_pipeline.sql
    0004_vehicle_year_resolution.sql
    0005_phase7_edition_scope.sql
  fixtures/
    verified.json
    canonical/
  scripts/
    seed.ts
    import-njkb.ts
    mock-bpad.ts
    local-worker.ts
  src/
    bpad/adapter.ts
    vehicle/normalize.ts
    db/
    ingestion/
    matching/
    http/response.ts
    index.ts
  tests/
    database.test.ts
    bpad-adapter.test.ts
    matching.test.ts
    api.test.ts
    ingestion.test.ts
  docs/
    api.md
    matching.md
    schema.md
    ingestion.md
    verification.md
    phase5-regulatory-resolution-report.md
    phase6-regulatory-resolution.md
    phase7-extraction.md
    phase7b-exception-resolution.md
    phase7c-final-resolution.md
    evidence/phase5-regulatory-evidence.json
    evidence/*extraction-qa.json
```

## Verified fixtures

| ID | Edition year | Vehicle year | Applicability | Regulation | Source code | NJKB | Page / row |
|---|---:|---:|---|---|---|---:|---|
| fixture-a2022 | 2025 | 2022 | approved | Pergub NTT 26/2025 | 701167 08549 | 11700000 | 503 / 5308 |
| fixture-a2023 | 2025 | 2023 | approved | Pergub NTT 26/2025 | 701167 08549 | 11900000 | 503 / 5309 |
| fixture-a | 2025 | 2024 | approved | Pergub NTT 26/2025 | 701167 08549 | 12500000 | 503 / 5310 |
| fixture-a2025 | 2025 | 2025 | approved | Pergub NTT 26/2025 | 701167 08549 | 12600000 | 503 / 5311 |
| fixture-b | 2026 | 2026 | approved | Permendagri 11/2026 | 701167 67749 | 12900000 | 55 / 311 |

`701167 08549` (Pergub) and `701167 67749` (Permendagri) are independent codes.
No automatic crosswalk exists between them.

## Production deployment

Production deployment is active at:

```text
https://njkb-api-ntt.elwinmusadi.workers.dev
```

Top-level Wrangler configuration remains local-only via a sentinel database ID;
`env.production` explicitly binds `njkb-api-production`. Do not run remote mutation
without `--env production --remote` and the operational preflight in
`docs/production-operations.md`.

Production baseline: 64,874 active references, zero vehicle mappings, health/ready
HTTP 200, and real BPAD-backed 2024/2025/2026 smoke tests verified.
