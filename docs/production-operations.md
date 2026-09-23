# Production Operations — NJKB API NTT

Dokumen ini adalah runbook operasional production. Canonical dataset, regulatory
resolution, matching hierarchy, public API contract, dan migration 0001–0005 adalah
frozen baseline.

## 1. Production Architecture

```text
Client
  → Cloudflare Worker njkb-api-ntt
  → BPAD NTT vehicle identity API
  → normalization
  → regulatory tier selection
  → D1 njkb-api-production
  → matching + match_audits
  → public JSON response
```

- Worker URL: `https://njkb-api-ntt.elwinmusadi.workers.dev`
- D1 name: `njkb-api-production`
- D1 UUID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`
- D1 region: APAC
- Binding: `NJKB_DB`

## 2. Frozen Regulatory Baseline

```text
vehicle_year <= 2025 → edition-2025 → Pergub NTT No. 26 Tahun 2025
vehicle_year = 2026  → edition-2026 → Permendagri No. 11 Tahun 2026
vehicle_year >= 2027 → reference_unavailable
```

Tidak boleh ada cross-year fallback, adjacent-year fallback, automatic alias, atau
unverified mapping.

## 3. Production Data Baseline

- Pergub: 62.091 references
- Permendagri: 2.783 references
- Total: 64.874 references
- Ingestion records: 64.874
- Completed manifests: 2
- Ingestion issues: 78
- Vehicle mappings: 0

Canonical file hashes:

- Pergub: `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c`
- Permendagri: `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e`

## 4. Deployment Prerequisites

Sebelum mutation production:

1. branch `main`, HEAD diketahui, origin synchronized, working tree clean;
2. `npm run typecheck`, `npm test`, dan `npm run build` lulus;
3. canonical count/hash cocok;
4. `artifacts/production/manifest.json` diregenerate dan seluruh chunk hash cocok;
5. Wrangler authenticated ke account yang benar;
6. D1 name dan UUID diverifikasi, bukan hanya binding;
7. ambil D1 Time Travel bookmark;
8. tulis change description, expected impact, verification, dan rollback plan.

## 5. D1 Deployment Procedure

Untuk initialization atau controlled rebuild database baru:

```sh
npm run export:production:sql
node --import tsx scripts/verify-production-sql-wrangler.ts
npx wrangler d1 migrations apply NJKB_DB --env production --remote
npm run deploy:production:d1 -- --remote
```

Runner memverifikasi manifest, byte size, SHA-256, dan transaction compatibility sebelum
chunk pertama. Network/fetch failure di-retry maksimum tiga attempt. SQL/schema/
constraint error selalu fail-fast. Resume partial deployment harus memakai state aktual:

```sh
npm run deploy:production:d1 -- --remote --start-at <verified-failed-chunk.sql>
```

Jangan menebak resume point. Verifikasi `ingestion_records.max(record_index)` dan count
per edition sebelum resume. Seluruh statement idempotent.

## 6. Worker Deployment Procedure

Worker hanya dideploy setelah D1 count/hash/sample/query-plan gate lulus:

```sh
npx wrangler deploy --env production
npx wrangler deployments list --env production
```

Catat commit SHA, version ID, timestamp, URL, binding D1, dan variables.

## 7. Post-Deployment Smoke Tests

### Infrastructure

```sh
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/health
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/ready
```

Expected: HTTP 200 `ok` dan `ready`.

### Regulatory fixtures

```sh
# 2024, exact code, Pergub
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4786PD

# 2025, exact code, Pergub
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4874PF

# 2026, exact identity, Permendagri
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH2630PI
```

Expected:

- 2024 → Pergub → 12.500.000
- 2025 → Pergub → 16.600.000
- 2026 → Permendagri → 16.900.000

### Negative fixtures

```sh
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/INVALID
curl -i "https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4874PF?tax_year=2025"
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH2212ET
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH2582PI
```

Expected: 400 `invalid_nopol`, 400 `unsupported_query_parameter`, 409 `conflict`, dan
404 `not_found`.

Jangan mencetak raw BPAD payload atau spreadsheet PII.

## 8. Worker Rollback

Current known-good version:

```text
20caad97-94f7-442e-a7a6-67a80592d73b
```

Previous clean version:

```text
de12e2dd-3622-4235-929c-84a7b2c6161a
```

Verifikasi version masih tersedia:

```sh
npx wrangler deployments list --env production
npx wrangler versions view <version-id> --env production
```

Rollback hanya dengan approval dan reason:

```sh
npx wrangler rollback <version-id> --env production --message "<reason>"
```

Setelah rollback, ulang `/health`, `/ready`, fixtures 2024/2025/2026, errors, headers,
dan match audit verification.

## 9. D1 Recovery

Worker rollback tidak me-rollback D1.

D1 production mendukung Time Travel. Pada Free plan, retention point-in-time adalah 7
hari; Workers Paid menyediakan 30 hari. Bookmark saat ini dapat diambil dengan:

```sh
npx wrangler d1 time-travel info njkb-api-production
```

Restore bersifat destructive, overwrite in-place, dan membatalkan in-flight query.
Jangan melakukan restore tanpa explicit approval dan incident evidence:

```sh
npx wrangler d1 time-travel restore njkb-api-production --bookmark=<approved-bookmark>
```

Jika Time Travel tidak mencakup recovery point, buat database baru, apply migration
0001–0005, deploy canonical artifacts, verifikasi penuh, lalu switch binding melalui
Worker deployment terkontrol. Jangan bulk-delete database production sebagai rollback.

Canonical source, migrations, exporter, manifest, dan verification scripts memungkinkan
reconstruction deterministik.

- RPO commitment: **NOT DEFINED**
- RTO commitment: **NOT DEFINED**

## 10. Backup / Export

Time Travel selalu aktif pada D1 production backend. Untuk snapshot SQL terkontrol:

```sh
npx wrangler d1 export njkb-api-production --remote --output <approved-secure-path.sql>
```

Export membaca data dan dapat memengaruhi read quota. Output harus disimpan di secure,
ignored location dan tidak di-commit. Retention di luar Time Travel belum ditetapkan.

## 11. D1 Quota dan Cost Behavior

Authoritative Cloudflare limits/pricing saat audit:

- Free rows read: 5 juta/hari
- Free rows written: 100.000/hari
- Free database size: 500 MB
- Free Time Travel: 7 hari
- limits reset 00:00 UTC

D1 menghitung index updates sebagai additional row writes. Karena itu import 64.874
references + 64.874 ingestion records + indexes menghasilkan jauh lebih dari 129.748
writes; production metrics pernah mencatat 584.346 rows written/24h. Bulk deployment
menghabiskan quota dan sementara memblokir runtime `match_audits` writes.

Operational separation:

1. deployment-time writes: sangat tinggi, harus dijadwalkan dan dimonitor;
2. runtime writes: minimal satu audit insert per resolved lookup ditambah index writes;
3. runtime reads: indexed lookup, jauh lebih kecil dari verification full scans;
4. re-ingestion: jangan dijalankan pada production tanpa quota/cost plan.

Pantau dashboard D1 Metrics > Row Metrics atau GraphQL Analytics. Jangan menjalankan
full-table count verification secara berkala; gunakan hanya saat deployment/incident.
Upgrade Workers Paid direkomendasikan sebelum bulk rebuild atau traffic tinggi.

## 12. Observability

Structured Worker log memuat:

- `event`
- `request_id`
- `method`
- sanitized `path`
- result category
- HTTP status
- duration

NOPOL dan PII tidak dicatat. Tail example:

```sh
npx wrangler tail --env production --format json
```

Request ID pada response dapat dicari di Worker logs. `match_audits` saat ini tidak
menyimpan request ID, sehingga correlation log ↔ D1 audit tidak langsung. Persistent
Logpush/alerting belum dikonfigurasi.

Monitoring minimum:

- `/health` availability;
- `/ready` D1 connectivity;
- unexpected 5xx/database/upstream error;
- 429 volume;
- BPAD latency dan timeout;
- D1 rows read/written quota;
- Worker duration.

## 13. Rate Limiting

Current application limiter: in-memory fixed window 60 request/60 detik, bounded 10.000
keys, per isolate. Ini defense-in-depth dan bukan global exact control.

Workers Rate Limiting binding juga locality-based/eventually consistent. Zone WAF rate
limiting membutuhkan custom domain/zone; current endpoint memakai `workers.dev`.
Global WAF rate limiting belum dikonfigurasi.

**RECOMMENDED INFRASTRUCTURE ACTION:** jika custom domain diaktifkan, buat WAF rate rule
untuk `/api/njkb/*`, characteristic IP, period/threshold berdasarkan baseline traffic dan
false-positive review. Jangan menetapkan threshold baru tanpa traffic evidence. Sampai
saat itu application limiter tetap dipertahankan.

## 14. Security Controls

- HTTPS + HSTS
- no-store
- request ID
- nosniff
- frame deny
- no-referrer
- restrictive CSP
- CORS disabled
- parameterized D1 queries
- server-controlled BPAD URL
- PII stripped at adapter/public response/log boundaries
- unsupported query parameter rejected
- local/preview/production D1 isolated
- `.env*`, `.dev.vars`, `.wrangler/`, generated artifacts, dan spreadsheet PII ignored

Production runtime dependencies memiliki 0 known vulnerability pada `npm audit
--omit=dev`. Full dev-tool audit menemukan advisories pada Vitest/Wrangler/Miniflare
transitives. Tooling tidak dibundle ke Worker, tetapi upgrade stable perlu dijadwalkan
sebagai dependency-maintenance task dengan full regression.

## 15. Incident Response Basics

1. Tentukan kategori: Worker, config, D1, BPAD, matching, quota, atau security.
2. Catat timestamp UTC, request ID, version ID, commit, D1 bookmark, dan exact symptom.
3. Hentikan mutation/cutover; jangan ubah canonical data.
4. Verifikasi `/health`, `/ready`, D1 counts, and recent Worker logs.
5. Untuk Worker regression, rollback version.
6. Untuk D1 corruption, gunakan approved Time Travel/rebuild path; jangan improvisasi
   destructive SQL.
7. Verifikasi smoke checklist dan simpan incident evidence sebelum menutup incident.

## 16. Known Operational Action Items

- HIGH: konfigurasi persistent logs/alerts untuk 5xx, readiness, upstream error, dan D1
  quota.
- HIGH: tetapkan D1 plan/quota policy sebelum bulk rebuild atau traffic tinggi.
- MEDIUM: definisikan RPO/RTO dan retention export di luar Time Travel.
- MEDIUM: evaluasi custom domain + WAF global rate rule berdasarkan traffic baseline.
- MEDIUM: upgrade dev toolchain untuk advisories, melalui PR terpisah dan full tests.
- LOW: evaluasi correlation ID pada `match_audits` hanya jika audit operations memang
  memerlukan direct correlation; ini memerlukan migration dan bukan scope Phase 8E.
