# Phase 8D — Production Deployment Report

Tanggal final verification: 23 September 2026.

## Status

**COMPLETE**

Production D1 terisi lengkap dan Worker production aktif. Health, readiness, real
BPAD-backed 2025/2026 fixtures, data counts/hashes, headers, error contract, query
plans, dan match audit lulus. Per-isolate limiter tetap menjadi documented limitation;
absence of live 429 bukan correctness defect atau global-rate-limit evidence.

## 1. Deployment Target

- Worker: `njkb-api-ntt`
- Environment: `production`
- Commit deployment: `fd5a12c00ab9a43b9593d903cfad9102e4c78589`
- D1: `njkb-api-production`
- D1 UUID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`
- Region: APAC
- URL: `https://njkb-api-ntt.elwinmusadi.workers.dev`
- Current Worker version: `20caad97-94f7-442e-a7a6-67a80592d73b`

## 2. Deployment Timeline

1. Resume gate lulus pada commit `dc94d0c`.
2. Data upload mulai dari empty schema.
3. Network failure terjadi pada chunk 111 setelah 38.500 rows committed.
4. Bounded network retry dan explicit `--start-at` support ditambahkan, diuji, committed,
   dan dipush sebagai commit `fd5a12c`.
5. State 38.500/max index 38.499 diverifikasi.
6. Upload dilanjutkan dari `pergub_chunk_111.sql` hingga 188/188.
7. Counts, manifests, samples, duplicates, semantic hashes, dan query plans lulus.
8. Worker production dideploy.
9. Health dan readiness lulus.
10. Known 2024 lookup awal gagal karena D1 free-tier write quota habis oleh bulk import.
11. Setelah reset midnight UTC, known 2024 lookup lulus dan match audit tercatat.
12. Error/security/rate-limit checks dijalankan secara terkendali.

## 3. Git Release Baseline

- Branch: `main`
- Deployment commit: `fd5a12c00ab9a43b9593d903cfad9102e4c78589`
- Git status sebelum deployment: clean
- origin/main sebelum deployment: synchronized

## 4. Migration Result

Migration 0001–0005 applied. Schema, FK, triggers, dan indexes terverifikasi.

## 5. Data Deployment Result

| Metric | Actual | Status |
|---|---:|---|
| SQL chunks | 188/188 | PASS |
| Regulations | 2 | PASS |
| Source documents | 2 | PASS |
| Reference editions | 2 | PASS |
| NJKB references | 64.874 | PASS |
| Pergub edition | 62.091 | PASS |
| Permendagri edition | 2.783 | PASS |
| Ingestion records | 64.874 | PASS |
| Completed manifests | 2 | PASS |
| Ingestion issues | 78 | PASS |
| Vehicle mappings | 0 | PASS |
| Duplicate source positions | 0 | PASS |
| Orphan ingestion records | 0 | PASS |

## 6. Data Hash Verification

File hashes:

- Pergub: `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c`
- Permendagri: `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e`

Stored semantic hashes cocok dengan local canonical validation:

- Pergub: `d0c78817c0c7c93dbecb9cebd5f224424af6f863d8250abdc8693fead004ecbf`
- Permendagri: `b01730ec515f25c4bfe3bb326cd0ddb829ce3befb961e1833626434bf080e663`

## 7. Worker Deployment

- URL: `https://njkb-api-ntt.elwinmusadi.workers.dev`
- Initial release version: `de12e2dd-3622-4235-929c-84a7b2c6161a`
- Diagnostic version sementara: `42f85b44-01e6-4e5b-b7f5-598de73545e4`
- Current clean version: `20caad97-94f7-442e-a7a6-67a80592d73b`
- Startup time: 15 ms
- D1 binding: `njkb-api-production`

## 8. Health & Readiness

| Endpoint | HTTP | Body | Duration | Status |
|---|---:|---|---:|---|
| `/health` | 200 | `{"status":"ok"}` | 0,642s | PASS |
| `/ready` | 200 | `{"status":"ready"}` | 0,529s | PASS |

## 9. Live API Smoke Tests

| Test | Expected | Actual | Status |
|---|---|---|---|
| 2024 `DH4786PD` | Pergub, 12.500.000, exact code | HTTP 200, Pergub, 12.500.000, exact code | PASS |
| 2025 `DH4874PF` | Pergub, 16.600.000, exact code | HTTP 200, Pergub, 16.600.000, exact code | PASS |
| 2025 `DH5122PF` | Pergub, 11.300.000, exact code | HTTP 200, Pergub, 11.300.000, exact code | PASS |
| 2025 `DH5580PF` | Pergub, 15.000.000, exact code | HTTP 200, Pergub, 15.000.000, exact code | PASS |
| 2026 `DH2630PI` | Permendagri, 16.900.000, exact identity | HTTP 200, Permendagri, 16.900.000, exact identity | PASS |
| 2026 `DH2634PI` | Permendagri, 16.900.000, exact identity | HTTP 200, Permendagri, 16.900.000, exact identity | PASS |
| 2026 `DH2642PI` | Permendagri, 16.900.000, exact identity | HTTP 200, Permendagri, 16.900.000, exact identity | PASS |
| Invalid NOPOL | HTTP 400 `invalid_nopol` | HTTP 400 | PASS |
| `?tax_year=2025` | HTTP 400 `unsupported_query_parameter` | HTTP 400 | PASS |

Real fixtures berasal dari spreadsheet user, diverifikasi langsung ke BPAD, lalu
di-cross-check dengan production D1. Dua real 2026 fixtures lain menghasilkan
`not_found` dan satu menghasilkan `conflict`, membuktikan tidak ada automatic fallback
atau unverified alias.

## 10. Security Verification

Live response 2024 memuat seluruh header wajib:

- `Cache-Control: no-store`
- `X-Request-ID`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

`Access-Control-Allow-Origin` tidak ada. PII/internal leakage scan menghasilkan 0 finding.

## 11. Rate Limit Verification

- Local deterministic limiter tests: PASS.
- Controlled live invalid requests: 65.
- Live HTTP 429 observed: tidak.

Limiter bersifat per-isolate; Cloudflare mendistribusikan request dan tidak menjamin
counter global. Karena itu live result inconclusive, bukan failure deterministik. WAF
global rate limiting belum dikonfigurasi dan tidak diklaim aktif.

## 12. Query Performance

Production query plans:

- exact code: `idx_njkb_code`
- exact identity: `idx_njkb_identity`

Status: PASS.

## 13. Match Audit

Final closure `match_audits` count: 15. Audit mencakup controlled probe dan live
matched/not-found/conflict lookups. Invalid NOPOL, query-parameter, dan controlled
rate-limit test tidak menambah match audit.

## 14. Observability

Initial production anomaly:

```text
D1 free tier daily row write limit exceeded
```

Bulk deployment menghasilkan lebih dari 130.000 row writes. Read queries tetap aktif,
tetapi match audit writes gagal sampai reset midnight UTC. Setelah reset, known lookup
dan audit write lulus. Observation window terbatas tidak menunjukkan unexpected 5xx lain.

## 15. Rollback Readiness

- Current version: `20caad97-94f7-442e-a7a6-67a80592d73b`
- Previous clean version: `de12e2dd-3622-4235-929c-84a7b2c6161a`
- Worker rollback tersedia melalui Cloudflare version mechanism.
- D1 data tidak memiliki automatic rollback. Data telah diverifikasi lengkap dan tidak
  memerlukan recovery.

## 16. Evidence Files

- `docs/evidence/phase8d-production-deployment.json`
- `docs/phase8d-production-deployment.md`
- `docs/evidence/phase8d-sql-remediation.json`

## 17. Problems Encountered

1. Remote explicit transaction incompatibility — diremediasi.
2. Transient network failure pada chunk 111 — resumed idempotently.
3. D1 free-tier daily row-write quota habis — pulih setelah reset UTC.
4. Synthetic 2025/2026 NOPOL tidak tersedia; closure diselesaikan dengan real NOPOL dari spreadsheet user.
5. Per-isolate limiter tidak menghasilkan observable live 429 pada 65 request; ini documented limitation, bukan correctness defect.

## 18. Production State

```text
Migrations:              applied
References:              64.874
Pergub:                  62.091
Permendagri:             2.783
Mappings:                0
Worker:                  deployed
Health:                  ready
Real 2024/2025/2026 E2E: passing
Traffic URL:             active workers.dev
```

## 19. Final Verdict

**PRODUCTION DEPLOYMENT VERIFIED**

Deployment infrastructure, database, Worker, health/readiness, real BPAD-backed
2024/2025/2026 lookups, security, data integrity, hashes, query plans, dan audit writes
terverifikasi. Per-isolate limiter dan WAF global dicatat sebagai known limitation,
bukan unresolved production defect.
