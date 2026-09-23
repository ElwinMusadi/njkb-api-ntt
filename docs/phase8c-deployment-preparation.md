# Phase 8C — Deployment Preparation Report & Runbook

Tanggal: 22 September 2026.  
Status: **COMPLETE**

Laporan ini merinci persiapan infrastruktur, pemisahan environment Wrangler, pembuatan pipeline data deployment D1 production, mitigasi constraint Cloudflare D1, runbook deployment, release manifest, serta prosedur rollback untuk Phase 8D.

---

## 1. Infrastructure Changes

- **Provisioning Database D1 Production:**
  - Resource D1 production telah dibuat di Cloudflare pada region APAC (`npx wrangler d1 create njkb-api-production --location apac`).
  - Database Name: `njkb-api-production`
  - Database UUID / ID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`
  - Region: APAC
- **Pemisahan Environment Wrangler:**
  - Konfigurasi `wrangler.jsonc` diperbarui dengan pemisahan eksplisit antara top-level (local/dev), `env.preview`, dan `env.production`.
  - Local/Dev tetap menggunakan database sentinel lokal (`00000000-0000-0000-0000-000000000001` / `njkb-ntt-local`) sehingga command development lokal tidak akan pernah memodifikasi database production.
- **Pipeline Export SQL Production:**
  - Dibuat script `scripts/export-production-sql.ts` untuk mengekspor 64.874 data kanonikal menjadi ordered idempotent SQL chunks yang kompatibel dengan remote D1. Explicit SQL transaction wrapper telah dihapus pada remediation Phase 8D karena tidak didukung `wrangler d1 execute --remote --file`.
  - Dibuat runner script `scripts/deploy-production-d1.ts` untuk mengeksekusi chunk SQL secara berurutan dan aman.
- **Batasan Penting:**
  - **TIDAK ADA** live deployment Worker yang dilakukan pada fase ini (`wrangler deploy` tidak dijalankan).
  - **TIDAK ADA** migrasi data live ke production D1 yang dieksekusi pada fase ini. Seluruh eksekusi live dialokasikan untuk Phase 8D.

---

## 2. Wrangler Configuration

File `wrangler.jsonc` telah dikonfigurasi dengan environment isolation:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "njkb-api-ntt",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-11",
  "workers_dev": false,
  "preview_urls": false,
  "vars": {
    "BPAD_TIMEOUT_MS": "5000",
    "NJKB_RESOLUTION_AS_OF": "2026-09-20"
  },
  "d1_databases": [
    {
      "binding": "NJKB_DB",
      "database_name": "njkb-ntt-local",
      "database_id": "00000000-0000-0000-0000-000000000001",
      "migrations_dir": "migrations"
    }
  ],
  "env": {
    "production": {
      "name": "njkb-api-ntt",
      "workers_dev": true,
      "vars": {
        "BPAD_TIMEOUT_MS": "5000",
        "NJKB_RESOLUTION_AS_OF": "2026-09-20"
      },
      "d1_databases": [
        {
          "binding": "NJKB_DB",
          "database_name": "njkb-api-production",
          "database_id": "ae3097b9-d76d-430f-b5c5-7653c8242b52",
          "migrations_dir": "migrations"
        }
      ]
    },
    "preview": {
      "name": "njkb-api-ntt-preview",
      "workers_dev": true,
      "vars": {
        "BPAD_TIMEOUT_MS": "5000",
        "NJKB_RESOLUTION_AS_OF": "2026-09-20"
      },
      "d1_databases": [
        {
          "binding": "NJKB_DB",
          "database_name": "njkb-ntt-local",
          "database_id": "00000000-0000-0000-0000-000000000001",
          "migrations_dir": "migrations"
        }
      ]
    }
  }
}
```

---

## 3. Production D1

- **Database Name:** `njkb-api-production`
- **Database ID:** `ae3097b9-d76d-430f-b5c5-7653c8242b52`
- **Region:** APAC (Asia Pacific)
- **Environment:** `production`
- **Binding Name:** `NJKB_DB`
- **Status:** Provisioned, 0 tables, 8 KB file size (menunggu migrasi di Phase 8D)

---

## 4. Migration Preparation

Seluruh migrasi 0001–0005 siap diterapkan secara linier ke production D1:
1. `0001_reference_database.sql`: Skema inti (`regulations`, `source_documents`, `reference_editions`, `njkb_references`, `vehicle_code_mappings`, `njmkb_references`, `match_audits`).
2. `0002_additional_provenance_checks.sql`: Trigger konsistensi audit dan batasan halaman.
3. `0003_ingestion_pipeline.sql`: Tabel lineage (`ingestion_manifests`, `ingestion_records`, `ingestion_issues`) dan kolom `extraction_method`.
4. `0004_vehicle_year_resolution.sql`: Tabel `match_audits` berbasis tanggal resolusi, indeks resolusi dan coverage.
5. `0005_phase7_edition_scope.sql`: Kolom `vehicle_year_min/max` dan trigger penegakan batas tahun edisi.

Perintah eksekusi Phase 8D:
```sh
npx wrangler d1 migrations apply NJKB_DB --env production --remote
```

---

## 5. Production SQL Export

Pipeline `scripts/export-production-sql.ts` mengekspor dataset kanonikal tervalidasi ke dalam direktori `artifacts/production/`.

### Strategi Chunking Berdasarkan Batasan Nyata Cloudflare D1
- **Constraint:** Cloudflare D1 API memberlakukan batas ukuran payload HTTP request sebesar 1 MB (1.048.576 bytes) dan batas waktu eksekusi transaksi per request.
- **Analisis Ukuran Baris:** Setiap record NJKB menyertakan 1 `INSERT INTO njkb_references` (lengkap dengan JSON string `raw_values`) dan 1 `INSERT INTO ingestion_records` (lengkap dengan `raw_values` dan `normalized_values`), berukuran rata-rata ~1,9 KB SQL text.
- **Pemilihan Chunk Size:** Ditetapkan `chunkSize = 350 records`.
  - Ukuran chunk maksimum: **729,5 KB** (747.001 bytes), berada aman di bawah batas 1 MB Cloudflare API (~71% dari limit).
  - Ukuran chunk minimum: **278,0 KB** (chunk sisa terakhir).
  - Waktu eksekusi lokal: ~250–400 ms per chunk.
- **Total Chunk:** **188 file SQL**
  - `00_metadata.sql`: Inisialisasi 2 regulasi, 2 source documents, 2 edisi referensi, dan 2 ingestion manifests awal.
  - `pergub_chunk_01.sql` s/d `pergub_chunk_178.sql`: 62.091 records Pergub NTT 26/2025.
  - `permendagri_chunk_01.sql` s/d `permendagri_chunk_08.sql`: 2.783 records Permendagri 11/2026.
  - `99_post_ingestion.sql`: 78 issue peringatan Pergub dan finalisasi status manifest menjadi `'completed'`.
- **Total Ukuran SQL:** 125,61 MB.
- **Manifest:** `artifacts/production/manifest.json`.

---

## 6. Dataset Verification

| Dataset | Expected Records | Actual Records | SHA-256 Hash | Status |
|---|---:|---:|---|---|
| Pergub NTT 26/2025 | 62.091 | 62.091 | `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c` | **PASS** |
| Permendagri 11/2026 | 2.783 | 2.783 | `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e` | **PASS** |
| **Total** | **64.874** | **64.874** | — | **PASS** |

Verifikasi membuktikan:
- Tidak ada data yang ditebak, diinterpolasi, atau dikarang.
- `vehicle_code_mappings` tetap **0**.
- `UNRESOLVED` tetap **0**.
- Seluruh 64.874 record lolos validasi kanonikal penuh.

---

## 7. Idempotency Verification

Pipeline ekspor SQL dirancang 100% idempoten:
- `INSERT INTO regulations ... ON CONFLICT(id) DO NOTHING;`
- `INSERT INTO source_documents ... ON CONFLICT(id) DO NOTHING;`
- `INSERT INTO reference_editions ... ON CONFLICT(id) DO NOTHING;`
- `INSERT INTO ingestion_manifests ... ON CONFLICT(id) DO NOTHING;`
- `INSERT INTO njkb_references ... ON CONFLICT(id) DO NOTHING;`
- `INSERT INTO ingestion_records ... ON CONFLICT(manifest_id, record_index) DO NOTHING;`
- `INSERT INTO ingestion_issues ... ON CONFLICT(manifest_id, record_index, code, field) DO NOTHING;`
- `UPDATE ingestion_manifests SET status='completed', ... WHERE id=...;`

Uji coba idempotesi pada `tests/production-sql-export.test.ts` membuktikan bahwa mengeksekusi ulang chunk SQL menghasilkan 0 baris duplikat dan tidak memicu error.

---

## 8. Routing Preparation

- Konfigurasi `workers_dev: true` diaktifkan pada `env.production`.
- URL akses default setelah deploy pada Phase 8D adalah:
  `https://njkb-api-ntt.<workers-subdomain>.workers.dev`
- **Placeholder Custom Domain (Opsional bagi Operator):**
  Jika domain kustom ingin diaktifkan pada Cloudflare Zone milik user:
  ```jsonc
  // Tambahkan pada env.production di wrangler.jsonc jika domain tersedia:
  "routes": [
    { "pattern": "njkb.nttprov.go.id/*", "custom_domain": true }
  ]
  ```
  Karena custom domain spesifik belum didaftarkan di zone Cloudflare akun saat ini, routing default menggunakan `workers.dev` yang aman dan terisolasi.

---

## 9. Secrets & Environment

Audit terhadap kebutuhan environment dan secret production:
- **Upstream Endpoint:** Menggunakan default `BPAD_VEHICLE_URL = 'https://dash.bpad.nttprov.go.id/pajak/webdtd/pendataan/core/php/getnopol.php'`.
- **Timeout:** `BPAD_TIMEOUT_MS = "5000"` (5 detik bounded timeout).
- **Resolution Date:** `NJKB_RESOLUTION_AS_OF = "2026-09-20"` (ditetapkan pada vars production untuk konsistensi deterministik).
- **Secrets:** Layanan ini tidak membutuhkan secret token atau password pihak ketiga karena integrasi BPAD bersifat publik tanpa autentikasi, dan D1 diakses via internal Worker binding.

---

## 10. WAF / Rate Limiting Preparation

- **In-Worker Rate Limiting:** Telah aktif di `src/index.ts` dengan threshold 60 req/menit per isolate berdasarkan `CF-Connecting-IP`.
- **Rekomendasi Cloudflare WAF Rate Limiting (Phase 8D):**
  Untuk mencegah abuse global lintas-isolate terhadap endpoint BPAD upstream, operator disarankan mengaktifkan Cloudflare WAF Rate Limiting Rule pada Cloudflare Dashboard:
  - **Match:** `http.request.uri.path matches "^/api/njkb/"`
  - **Rate:** 60 requests per 1 minute
  - **Action:** Block with HTTP 429 (Retry-After)
  - **Mitigation:** Melindungi IP Worker dari potensi pemblokiran oleh BPAD NTT.

---

## 11. Test Results

Hasil eksekusi pengujian aktual:

| Test Suite | File | Tests | Status |
|---|---|---:|---|
| Production SQL Export & Pipeline | `tests/production-sql-export.test.ts` | 5 | **PASS** |
| API & Operational Endpoints | `tests/api.test.ts` | 24 | **PASS** |
| BPAD Adapter & Resilience | `tests/bpad-adapter.test.ts` | 9 | **PASS** |
| In-Worker Rate Limiter | `tests/rate-limit.test.ts` | 4 | **PASS** |
| D1 Reference Database & Trigger | `tests/database.test.ts` | 28 | **PASS** |
| Matching Engine & Boundary | `tests/matching.test.ts` | 20 | **PASS** |
| Ingestion Pipeline & Validation | `tests/ingestion.test.ts` | 24 | **PASS** |
| **Total** | **7 files** | **114** | **ALL PASS** |

- `npm run typecheck`: **PASS** (0 errors)
- `npm run build`: **PASS** (Dry-run bundle 857,72 KiB / gzip 141,76 KiB)
- `npm run phase7:verify:local`: **PASS** (64.874 references, 0 mappings, indexed query plans)
- `npm run phase7b:verify:samples`: **PASS** (40/40 deterministik)

---

## 12. Files Changed

- `wrangler.jsonc`: Penambahan konfigurasi `env.production` dan `env.preview` dengan UUID database D1 aktual `ae3097b9-d76d-430f-b5c5-7653c8242b52`.
- `package.json`: Penambahan script `"export:production:sql"` dan `"deploy:production:d1"`, perbaikan script build `--env=""`.
- `.gitignore`: Penambahan `artifacts/` agar file chunk SQL tidak membebani riwayat git.

---

## 13. Files Created

- `scripts/export-production-sql.ts`: Generator chunk SQL dan manifest deployment produksi.
- `scripts/deploy-production-d1.ts`: Runner eksekusi deployment chunk SQL ke D1.
- `tests/production-sql-export.test.ts`: Test suite verifikasi pipeline SQL export dan eksekusi D1.
- `docs/phase8c-deployment-preparation.md`: Laporan dan runbook deployment Phase 8C.

---

## 14. Deployment Runbook (Untuk Phase 8D)

### Tahap 1: Preflight Verification
Pastikan repositori bersih dan terverifikasi:
```sh
npm run typecheck
npm test
npm run build
```

### Tahap 2: Generate Production SQL Artifacts
Ekspor data kanonikal ke ordered idempotent SQL chunks tanpa explicit transaction wrapper:
```sh
npm run export:production:sql
```
Verifikasi bahwa `artifacts/production/manifest.json` memuat 64.874 record dan 188 chunk.

### Tahap 3: D1 Remote Migrations
Terapkan migrasi 0001–0005 ke database production Cloudflare D1:
```sh
npx wrangler d1 migrations apply NJKB_DB --env production --remote
```

### Tahap 4: D1 Remote Data Deployment
Eksekusi seluruh 188 chunk SQL ke database production Cloudflare D1:
```sh
npm run deploy:production:d1 -- --remote
```

### Tahap 5: Verifikasi Data Production D1
Verifikasi jumlah data di remote D1:
```sh
npx wrangler d1 execute njkb-api-production --remote --command "SELECT count(*) AS total_references FROM njkb_references; SELECT edition_id, count(*) AS count FROM njkb_references GROUP BY edition_id; SELECT count(*) AS mappings FROM vehicle_code_mappings;"
```
Expected output:
- `total_references`: 64.874
- `edition-2025`: 62.091
- `edition-2026`: 2.783
- `mappings`: 0

### Tahap 6: Worker Deployment
Deploy Worker ke environment production Cloudflare:
```sh
npx wrangler deploy --env production
```

### Tahap 7: Post-Deployment Smoke Verification
Uji live endpoint production:
```sh
# 1. Liveness check
curl -i https://<worker-url>/health

# 2. Readiness check (D1 connectivity)
curl -i https://<worker-url>/ready

# 3. Known vehicle 2024 (Pergub)
curl -i https://<worker-url>/api/njkb/DH4786PD

# 4. Known vehicle 2026 (Permendagri)
curl -i https://<worker-url>/api/njkb/DH2026ZZ

# 5. Unsupported query parameter check
curl -i "https://<worker-url>/api/njkb/DH4786PD?tax_year=2025"
```

### Prosedur Rollback
1. **Rollback Worker Code:**
   Jika terjadi regresi kode Worker, gunakan fitur rollback versi Cloudflare:
   ```sh
   npx wrangler rollback --env production
   ```
2. **Recovery Database D1:**
   Worker rollback tidak me-rollback D1. Jangan menjalankan bulk `DELETE` sebagai
   rollback. Sebelum mutation production, ambil bookmark:
   ```sh
   npx wrangler d1 time-travel info njkb-api-production
   ```
   Jika terjadi corruption, hentikan traffic/mutation, simpan evidence dan current
   bookmark, lalu gunakan Time Travel restore hanya setelah explicit approval:
   ```sh
   npx wrangler d1 time-travel restore njkb-api-production --bookmark=<approved-bookmark>
   ```
   Restore bersifat destructive dan membatalkan in-flight query. Setelah restore,
   verifikasi migration state, counts, canonical semantic hashes, samples, `/ready`,
   dan real 2024/2025/2026 fixtures. Jika restore point tidak tersedia, rebuild database
   baru dari migration 0001–0005 dan canonical artifacts, verifikasi penuh, kemudian
   switch binding melalui deployment terkontrol. Jangan overwrite production secara
   improvisasi.

---

## 15. Release Manifest

```json
{
  "release": "Phase 8C / Ready for Phase 8D",
  "project": "njkb-api-ntt",
  "version": "0.5.0",
  "cloudflare_environment": "production",
  "target_database": {
    "name": "njkb-api-production",
    "id": "ae3097b9-d76d-430f-b5c5-7653c8242b52",
    "binding": "NJKB_DB",
    "region": "apac"
  },
  "migrations": [
    "0001_reference_database.sql",
    "0002_additional_provenance_checks.sql",
    "0003_ingestion_pipeline.sql",
    "0004_vehicle_year_resolution.sql",
    "0005_phase7_edition_scope.sql"
  ],
  "canonical_datasets": {
    "pergub": {
      "path": "fixtures/canonical/pergub-ntt-26-2025.full.json",
      "records": 62091,
      "sha256": "c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c"
    },
    "permendagri": {
      "path": "fixtures/canonical/permendagri-11-2026.full.json",
      "records": 2783,
      "sha256": "fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e"
    }
  },
  "total_active_references": 64874,
  "vehicle_code_mappings": 0,
  "sql_deployment_artifacts": {
    "total_chunks": 188,
    "chunk_size_records": 350,
    "max_chunk_bytes": 747001,
    "total_sql_bytes": 131711200,
    "manifest_path": "artifacts/production/manifest.json"
  }
}
```

---

## 16. Manual Actions Remaining (Untuk Phase 8D)

1. Menjalankan migrasi D1 remote: `npx wrangler d1 migrations apply NJKB_DB --env production --remote`.
2. Menjalankan deployment data SQL remote: `npm run deploy:production:d1 -- --remote`.
3. Menjalankan deploy Worker remote: `npx wrangler deploy --env production`.
4. Melakukan verifikasi smoke test pada URL produksi yang aktif.
5. (Opsional) Mengonfigurasi Cloudflare WAF Rate Limiting rule di dashboard.

---

## 17. Stop Conditions Encountered

**TIDAK ADA STOP CONDITION YANG DILANGGAR.**
- Canonical hash tidak berubah.
- Jumlah record tidak berubah (64.874).
- Regulatory tier dan matching hierarchy tetap.
- Database production terisolasi dari local environment.
- Tidak ada traffic cutover live yang dilakukan.

---

## 18. Phase 8D Readiness

Semua kriteria penerimaan Phase 8C telah terpenuhi secara penuh:
- Database D1 production telah dibuat dan diidentifikasi dengan UUID aktual.
- Konfigurasi Wrangler terisolasi dan bebas error.
- Pipeline ordered/idempotent SQL remote-compatible, bounded retry, dan resume telah teruji secara menyeluruh.
- 114/114 tests PASS.
- Deployment runbook dan release manifest telah terdokumentasi lengkap.

**READY FOR PHASE 8D**
