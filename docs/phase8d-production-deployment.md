# Phase 8D — Production Deployment Report

Tanggal resume: 22 September 2026.

## Status

**PARTIAL**

Resume preflight lulus. Production data upload berhenti pada chunk 111/188 karena
transient Cloudflare fetch/connectivity failure. Chunk 1–110 sudah committed secara
konsisten; failed chunk menulis 0 row. Sesuai stop condition, tidak ada retry otomatis,
chunk skip, Worker deployment, atau live traffic activation.

## 1. Deployment Target

- Worker: `njkb-api-ntt`
- Environment: `production`
- Account ID: `04b8b2073be2f1aa21fc6489e0db36f6`
- D1: `njkb-api-production`
- D1 UUID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`
- Region: APAC
- Worker deployed: tidak
- Production URL: belum ada

## 2. Deployment Timeline

1. Git baseline dan origin synchronization diverifikasi.
2. Artifact/canonical/account/D1/Worker preflight lulus.
3. `RESUME DATA DEPLOYMENT GATE: PASS`.
4. Runner memvalidasi 188 chunk hash, size, manifest, dan transaction syntax.
5. Metadata serta `pergub_chunk_01`–`pergub_chunk_110` berhasil.
6. `pergub_chunk_111.sql` gagal karena fetch connectivity failure.
7. Runner berhenti. Tidak ada retry atau skip.
8. Remote state diukur read-only.
9. Worker deployment dibatalkan.

## 3. Git Release Baseline

- Branch: `main`
- Commit: `dc94d0ce07b934e5466e0eeb1f4ef200f6bb8dd0`
- Working tree sebelum mutation: bersih
- origin/main: synchronized

## 4. Migration Result

Migration 0001–0005 sebelumnya applied dan tidak diulang.

```text
No migrations to apply
```

## 5. Data Deployment Result

Command:

```sh
npm run deploy:production:d1 -- --remote
```

Result:

- Artifact preflight: PASS
- Successful chunks: 110
- Failed chunk: 111 (`pergub_chunk_111.sql`)
- Total chunks: 188
- Failure category: transient Wrangler/Cloudflare fetch connectivity failure
- Failed chunk rows written: 0
- Last committed `record_index`: 38.499
- Retry: tidak dilakukan
- Skipped chunk: 0

Remote D1 setelah stop:

| Table / dataset | Count |
|---|---:|
| regulations | 2 |
| source_documents | 2 |
| reference_editions | 2 |
| njkb_references | 38.500 |
| edition-2025 | 38.500 |
| edition-2026 | 0 |
| ingestion_records | 38.500 |
| ingestion_manifests | 2 |
| ingestion_issues | 0 |
| vehicle_code_mappings | 0 |

Kedua manifest masih berstatus `importing`, sesuai partial deployment.

## 6. Data Hash Verification

Canonical dan artifacts sebelum deployment:

- Pergub: 62.091 / `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c`
- Permendagri: 2.783 / `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e`
- Manifest: `f58d944060c4017536c714c274d2207b7e7b22373f73065766421ed6b6c19098`
- Aggregate SQL: `a3201641ca67193a63c50aabaf8a9cb7fb2e5e60ebf48821b488d76cd73d8c80`

Production hash verification belum dapat dilakukan karena upload belum lengkap.

## 7. Worker Deployment

Tidak dijalankan karena production data deployment gate gagal.

## 8. Health & Readiness

Tidak dijalankan karena Worker belum dideploy.

## 9. Live API Smoke Tests

Tidak dijalankan.

## 10. Security Verification

Live verification tidak dijalankan. Local regression tetap PASS.

## 11. Rate Limit Verification

Live verification tidak dijalankan. Cloudflare WAF global tidak diklaim aktif.

## 12. Query Performance

Production query plans belum dievaluasi karena data belum lengkap.

## 13. Match Audit

Tidak ada Worker/live lookup; `match_audits` tidak diverifikasi.

## 14. Observability

Tidak ada Worker traffic. Data upload menunjukkan beberapa chunk latency spike, tetapi
failure aktual adalah fetch connectivity error pada Wrangler request.

## 15. Rollback Readiness

- Worker rollback tidak diperlukan; Worker belum dideploy.
- Tidak dilakukan destructive D1 rollback.
- Partial rows valid dan berasal dari artifact idempoten.
- Safe recovery adalah melanjutkan dari `pergub_chunk_111.sql` setelah state read-only
  diverifikasi lagi. Metadata/chunk sebelumnya tidak perlu dihapus.

## 16. Evidence Files

- `docs/evidence/phase8d-production-deployment.json`
- `docs/phase8d-production-deployment.md`

## 17. Problems Encountered

```text
A fetch request failed, likely due to a connectivity issue.
fetch failed
```

Failure bukan SQL/data/constraint error. Namun sesuai aturan “satu chunk gagal → STOP”,
deployment tidak dilanjutkan otomatis.

## 18. Production State

```text
Migrations:                  applied
Schema:                      present
References:                  38.500 / 64.874
Pergub:                      38.500 / 62.091
Permendagri:                 0 / 2.783
Manifests:                   2 (importing)
Mappings:                    0
Worker:                      not deployed
Traffic:                     inactive
```

## 19. Final Verdict

**PRODUCTION DEPLOYMENT PARTIAL**

Data deployment harus di-resume secara idempoten dari failed chunk 111 setelah
preflight state berikutnya. Worker deployment tetap blocked sampai 188/188 chunks,
final counts, samples, dan production query plans lulus.
