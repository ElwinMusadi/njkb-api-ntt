# Phase 8E — Production Operational Readiness Report

Tanggal audit: 23 September 2026.

## 1. Baseline

- Phase 8D: `PRODUCTION DEPLOYMENT VERIFIED`
- Production URL: `https://njkb-api-ntt.elwinmusadi.workers.dev`
- Worker version: `20caad97-94f7-442e-a7a6-67a80592d73b`
- Worker deployment commit: `fd5a12c00ab9a43b9593d903cfad9102e4c78589`
- Phase 8D closure commit: `fbf4b2cda2e1dfbc646f609817dcae435ec26f7b`
- D1: `njkb-api-production`
- D1 UUID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`
- D1 region: APAC
- D1 size: 121.032.704 bytes
- Production references: 64.874
- Health/ready saat audit: HTTP 200/200

Regulatory, matching, canonical data, migrations, dan public API contract tidak diubah.

## 2. Configuration Audit

| Area | Result | Severity | Evidence |
|---|---|---|---|
| Environment isolation | PASS | INFO | Top-level local sentinel, explicit `preview`, explicit `production` |
| D1 binding | PASS | INFO | Current Worker version binds UUID `ae3097b9-...` |
| Secrets | PASS | INFO | Tidak ditemukan key/token/password/private key; D1 memakai binding |
| Variables | PASS WITH NOTE | LOW | Timeout 5.000 ms; resolution date pinned `2026-09-20`, future update harus eksplisit |
| Worker config | PASS | INFO | Compatibility date fixed; workers.dev production endpoint aktif |
| PII spreadsheet | PASS | INFO | `Data Potensi September.xlsx` ignored dan tidak tracked |
| Generated SQL artifacts | PASS | INFO | `artifacts/` ignored; reproducible dari canonical data |
| Preview isolation | PASS WITH NOTE | LOW | Preview tetap memakai local sentinel; preview remote resource belum diprovision |

Production/local D1 tidak tertukar. Database ID adalah public resource identifier, bukan
secret. Tidak ada credentials plaintext pada source control.

## 3. Security Audit

### Runtime controls

- HTTPS dan HSTS: PASS
- `Cache-Control: no-store`: PASS
- `X-Request-ID`: PASS
- `X-Content-Type-Options: nosniff`: PASS
- `X-Frame-Options: DENY`: PASS
- `Referrer-Policy: no-referrer`: PASS
- API-only CSP: PASS
- CORS disabled: PASS
- Parameterized SQL: PASS
- BPAD endpoint server-controlled: PASS
- PII stripping/log sanitization: PASS
- Error detail sanitization: PASS

### Repository hygiene

- `.env*`, `.dev.vars`, `.wrangler/`, local DB, generated artifacts, dan spreadsheet PII
  tidak tracked.
- Tidak ditemukan secret material.

### Dependency audit

`npm audit --omit=dev`: 0 vulnerability pada production dependency.

Full toolchain audit menemukan advisories pada Vitest, Wrangler/Miniflare, dan
transitive development packages. Tool tersebut tidak dibundle ke runtime Worker.
Upgrade stable perlu dilakukan dalam dependency-maintenance PR terpisah dengan full
regression, bukan hot change production Phase 8E.

## 4. Observability

### Current capability

Structured logs memuat:

- `event`
- `request_id`
- `method`
- sanitized `path`
- result category
- HTTP status
- duration

Production tail memverifikasi health event berikut tanpa PII:

```json
{"event":"http_request","request_id":"...","method":"GET","path":"/health","result":"healthy","http_status":200,"duration_ms":0}
```

Request ID memungkinkan correlation terhadap Worker logs. Error responses membedakan
public error categories; structured normal response log membedakan high-level result
(`matched`, `not_found`, `conflict`, `upstream_error`, dan lain-lain).

### Gaps

- Persistent Logpush/log retention belum dikonfigurasi.
- Alerting untuk 5xx, `/ready`, BPAD failure, dan D1 quota belum dikonfigurasi.
- `match_audits` tidak menyimpan request ID, sehingga direct log-to-audit correlation
  memerlukan time/vehicle context dan tidak deterministik.
- Upstream subcategory (`timeout`, `network_error`, `invalid_payload`) tersedia pada
  public response tetapi normal request log hanya mencatat high-level `upstream_error`.

Observability cukup untuk manual troubleshooting melalui `wrangler tail`, tetapi belum
mature untuk unattended production operations.

## 5. Rate Limiting / WAF

### Application limiter

- Fixed window 60 request/60 detik
- Bounded 10.000 keys
- Per Worker isolate
- Tidak menggunakan D1
- Local deterministic tests PASS

Ini defense-in-depth, bukan global exact limit. Production 65-request test tidak
menghasilkan 429 karena isolate distribution; hasil ini sesuai documented limitation.

### Cloudflare layer

- Wrangler tidak mendefinisikan Workers Rate Limiting binding.
- Current endpoint memakai `workers.dev`, bukan custom zone route.
- Zone WAF/global rate-limiting rule tidak dikonfigurasi melalui repository dan tidak
  terverifikasi aktif.
- Free WAF plan mendukung satu path/IP rate rule, tetapi custom zone/domain diperlukan
  agar zone rule dapat diterapkan pada API host.
- Workers Rate Limiting binding adalah locality-based/eventually consistent, bukan
  global exact accounting.

**GLOBAL RATE LIMITING RECOMMENDED**, non-blocking. Prioritas MEDIUM sampai traffic
baseline dan custom domain tersedia. Threshold harus ditentukan dari observed legitimate
traffic dan NAT/mobile false-positive risk; jangan menyalin angka 60/min secara otomatis.

## 6. D1 Quota / Cost

Authoritative Cloudflare documentation saat audit:

- Free rows read: 5 juta/hari
- Free rows written: 100.000/hari
- Paid included rows read: 25 miliar/bulan
- Paid included rows written: 50 juta/bulan
- Free database size: 500 MB
- Current database size: ~121 MB
- Free Time Travel: 7 hari
- Paid Time Travel: 30 hari
- quota reset: 00:00 UTC

Tidak ada biaya exact yang diestimasi karena expected traffic dan plan belum
ditetapkan.

### Deployment-time writes

Canonical deployment menulis 64.874 references, 64.874 ingestion records, metadata,
issues, dan index entries. Actual D1 metrics mencatat 584.346 rows written/24h setelah
bulk deployment. Ini melebihi Free daily write allowance dan sempat memblokir runtime
`match_audits` writes hingga reset UTC.

### Runtime writes

Setiap resolved lookup menulis satu audit row plus index updates. Runtime write volume
berbanding lurus dengan lookup traffic. Free plan dapat diterima untuk traffic rendah,
tetapi harus dimonitor.

### Runtime reads

Normal lookup memakai indexes dan membaca sedikit row. Full count/integrity queries
membaca puluhan/ratusan ribu row dan tidak boleh dijadikan periodic health check.

### Recommendation

- HIGH: pantau D1 row metrics dan konfigurasi quota alert/runbook.
- HIGH: gunakan Workers Paid sebelum bulk rebuild/re-ingestion atau traffic tinggi.
- Jangan menonaktifkan audit untuk menghemat write tanpa separate approved design change.

## 7. Backup / Recovery

### Authoritative reconstruction source

```text
canonical JSON
→ validation
→ SQL artifact export
→ migration 0001–0005
→ D1 deployment
→ counts/hash/samples verification
```

Canonical files dan migrations tersimpan di Git; SQL artifacts dapat diregenerate.

### Time Travel

D1 production backend mendukung Time Travel. Bookmark berhasil diambil saat audit.
Retention current Free plan: 7 hari. Restore destructive dan membutuhkan explicit
approval.

### Export

Wrangler mendukung remote SQL export. Export harus disimpan pada secure ignored path,
tidak di Git. Long-term export retention belum ditentukan.

### Recovery modes

1. Worker regression: rollback version Cloudflare, kemudian smoke test.
2. D1 recent corruption: approved Time Travel restore, kemudian full verification.
3. D1 unrecoverable/outside retention: create database baru, migrations, canonical
   rebuild, verification, controlled binding switch.

Worker rollback tidak me-rollback D1.

- RPO commitment: **NOT DEFINED**
- RTO commitment: **NOT DEFINED**

Ini action item MEDIUM, bukan current correctness blocker.

## 8. Deployment Safety

### Controls yang tersedia

- Git clean/sync preflight
- canonical count/hash gate
- manifest/chunk SHA gate
- production account/D1 identity verification
- migration gate
- chunk ordering
- fail-fast non-network error
- bounded network retry maksimum 3 attempt
- explicit `--start-at` resume
- idempotent statements
- two-pass exact-artifact local verification
- post-deployment count/hash/sample/query-plan gate
- Worker deployed hanya setelah data gate
- deployment evidence recording

### Risks remaining

- Sebagian flow masih manual dan tidak dijalankan oleh CI/CD.
- Runner memilih remote database berdasarkan name/account login; operator tetap wajib
  memverifikasi account dan UUID sebelum execution.
- Resume point harus ditentukan dari remote record/index state; tidak otomatis ditemukan.
- SQL artifact tidak atomic lintas 188 chunks; manifest `importing` dan idempotency
  menangani partial deployment.

Pipeline repeatable dan aman bila runbook diikuti. Tidak ada destructive command otomatis.

## 9. Smoke Test Checklist

### Infrastructure

```sh
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/health
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/ready
```

Expected HTTP 200 `ok` dan `ready`.

### Regulatory fixtures

| Year | NOPOL | Expected |
|---:|---|---|
| 2024 | `DH4786PD` | matched, Pergub, 12.500.000 |
| 2025 | `DH4874PF` | matched, Pergub, 16.600.000 |
| 2026 | `DH2630PI` | matched, Permendagri, 16.900.000 |

```sh
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4786PD
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4874PF
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH2630PI
```

### Negative fixtures

| Case | Request | Expected |
|---|---|---|
| invalid NOPOL | `/api/njkb/INVALID` | HTTP 400 `invalid_nopol` |
| unsupported tax year | `/api/njkb/DH4874PF?tax_year=2025` | HTTP 400 `unsupported_query_parameter` |
| known conflict | `/api/njkb/DH2212ET` | HTTP 409 `conflict` |
| known not found | `/api/njkb/DH2582PI` | HTTP 404 `not_found` |

Untuk matched responses, cross-check year, method, regulation, source code, NJKB,
weight, page/row, security headers, CORS, dan PII. Jangan menyimpan raw BPAD payload.

## 10. Performance

Production query plans:

- exact code → `idx_njkb_code`
- exact identity → `idx_njkb_identity`

Normal lookup melakukan indexed edition/coverage/code-or-identity queries dan satu audit
write. Tidak ditemukan full-table scan pada lookup path. BPAD network latency adalah
komponen dominan. Tidak diperlukan optimization baru.

Full integrity count query membaca banyak row dan hanya sesuai untuk deployment/incident,
bukan health endpoint.

## 11. Operational Documentation

Created:

- `docs/production-operations.md`
- `docs/phase8e-operational-readiness.md`

Updated:

- `docs/phase8c-deployment-preparation.md` — destructive bulk-delete rollback diganti
  dengan Time Travel/canonical reconstruction procedure.

Existing evidence retained:

- Phase 8A readiness audit
- Phase 8B hardening report
- Phase 8C deployment preparation
- Phase 8D deployment and final closure evidence

## 12. Action Items

| Priority | Action | Reason | Blocking? |
|---|---|---|---|
| HIGH | Konfigurasi persistent logs/alerts untuk 5xx, readiness, upstream failure, dan D1 quota | Current troubleshooting manual via tail | No |
| HIGH | Tetapkan Workers plan/quota policy sebelum bulk rebuild atau traffic tinggi | Free write limit terbukti terlampaui saat import | No untuk traffic rendah; Yes sebelum rebuild |
| MEDIUM | Definisikan RPO/RTO dan external export retention | Time Travel retention terbatas 7 hari Free | No |
| MEDIUM | Evaluasi custom domain + WAF global rate rule berdasarkan observed traffic | Current limiter per isolate; no global WAF | No |
| MEDIUM | Upgrade Vitest/Wrangler/Miniflare toolchain melalui PR terpisah | Dev tooling advisories; runtime production dependencies clean | No |
| MEDIUM | Tambahkan CI checks untuk tests/build/canonical/artifact integrity | Deployment preflight masih manual | No |
| LOW | Evaluasi request ID pada `match_audits` bila direct correlation dibutuhkan | Current correlation hanya melalui logs/time/context | No |
| LOW | Provision preview D1 remote jika staging environment diperlukan | Current preview uses local sentinel | No |

## 13. Final Classification

**OPERATIONALLY READY WITH ACTION ITEMS**

Tidak ditemukan critical production safety, data integrity, PII, configuration-isolation,
atau recovery blocker. Action items terutama maturity/monitoring/quota governance.

## 14. Phase Decision

- Phase 8E dapat ditutup: **YA**.
- Remaining action items: persistent alerting, quota/plan policy, RPO/RTO, global WAF,
  dependency maintenance, dan CI automation.
- Blocker sebelum production menerima traffic: **TIDAK ADA**.
- Project siap masuk fase berikutnya: **YA**.
