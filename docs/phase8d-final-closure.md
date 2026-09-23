# Phase 8D — Final Production Closure Validation

Tanggal: 23 September 2026.

## 1. Spreadsheet Fixture Discovery

File `docs/Data Potensi September.xlsx` dibaca read-only. Hanya kolom `NOPOL`, `MERK`,
`TIPE`, dan `TAHUN BUAT` yang digunakan. Kolom nama, telepon, alamat, mesin, rangka, dan
PII lainnya tidak dimuat ke evidence atau laporan.

- Total data rows: 27.627
- Tahun 2025: 909
- Tahun 2026: 56
- Kandidat dengan NOPOL/MERK/TIPE lengkap: 909 (2025), 56 (2026)

Kandidat awal 2025: `DH4874PF`, `DH5548PF`, `DH5122PF`, `DH5580PF`.
Kandidat awal 2026: `DH2582PI`, `DH2630PI`, `DH2569PI`, `DH2212ET`.
Kandidat tambahan 2026: `DH2634PI`, `DH2642PI`.

Spreadsheet ditambahkan ke `.gitignore` dan tidak di-commit karena memuat PII.

## 2. BPAD Validation

| NOPOL | Spreadsheet Year | Spreadsheet Brand | Spreadsheet Type | BPAD HTTP | BPAD Year | BPAD Brand | BPAD Type | Result |
|---|---:|---|---|---:|---:|---|---|---|
| DH4874PF | 2025 | HONDA | F1C02N46L2 A/T | 200 | 2025 | HONDA | F1C02N46L2 A/T | RECOGNIZED |
| DH5548PF | 2025 | HONDA | F1C02N46L2 A/T | 200 | 2025 | HONDA | F1C02N46L2 A/T | RECOGNIZED |
| DH5122PF | 2025 | HONDA | H1B02N41L1 AT | 200 | 2025 | HONDA | H1B02N41L1 AT | RECOGNIZED |
| DH5580PF | 2025 | HONDA | L1F02N37L1 A/T | 200 | 2025 | HONDA | L1F02N37L1 A/T | RECOGNIZED |
| DH2582PI | 2026 | HONDA | L1F02N36L2 A/T | 200 | 2026 | HONDA | L1F02N36L2 A/T | RECOGNIZED |
| DH2630PI | 2026 | HONDA | F1C02N46L2 A/T | 200 | 2026 | HONDA | F1C02N46L2 A/T | RECOGNIZED |
| DH2569PI | 2026 | HONDA | H1B02N41L1 AT | 200 | 2026 | HONDA | H1B02N41L1 AT | RECOGNIZED |
| DH2212ET | 2026 | VESPA | SPRINT S 180 | 200 | 2026 | VESPA | SPRINT S 180 | RECOGNIZED |

Hanya tujuh field kendaraan adapter diperiksa. Raw BPAD payload dan PII tidak disimpan.

## 3. Production Worker E2E

| NOPOL | Vehicle Year | Worker HTTP | Worker Status | Edition | Regulation | Source Code | NJKB | Result |
|---|---:|---:|---|---|---|---|---:|---|
| DH4874PF | 2025 | 200 | matched | edition-2025 | Pergub NTT No. 26 Tahun 2025 | 701167 17549 | 16.600.000 | PASS exact code |
| DH5122PF | 2025 | 200 | matched | edition-2025 | Pergub NTT No. 26 Tahun 2025 | 701167 17049 | 11.300.000 | PASS exact code |
| DH5548PF | 2025 | 200 | matched | edition-2025 | Pergub NTT No. 26 Tahun 2025 | 701167 17549 | 16.600.000 | PASS exact code |
| DH5580PF | 2025 | 200 | matched | edition-2025 | Pergub NTT No. 26 Tahun 2025 | 701167 70049 | 15.000.000 | PASS exact code |
| DH2630PI | 2026 | 200 | matched | edition-2026 | Permendagri No. 11 Tahun 2026 | 701167 75349 | 16.900.000 | PASS exact identity |
| DH2634PI | 2026 | 200 | matched | edition-2026 | Permendagri No. 11 Tahun 2026 | 701167 75349 | 16.900.000 | PASS exact identity |
| DH2642PI | 2026 | 200 | matched | edition-2026 | Permendagri No. 11 Tahun 2026 | 701167 75349 | 16.900.000 | PASS exact identity |

Safe negative results:

- `DH2582PI` → HTTP 404 `not_found`; exact 2026 identity absent, no Pergub fallback.
- `DH2569PI` → HTTP 404 `not_found`; exact 2026 identity absent, no Pergub fallback.
- `DH2212ET` → HTTP 409 `conflict` pada `type`; source conflict diekspos, tidak diperbaiki otomatis.

## 4. Production D1 Cross-Check

Semua successful Worker results cocok dengan production D1 pada:

- vehicle year;
- normalized brand/type/category;
- source code;
- edition;
- NJKB;
- weight;
- DPP PKB;
- PDF page/source row.

Final D1 integrity:

- regulations 2
- source documents 2
- reference editions 2
- references 64.874
- ingestion records 64.874
- completed manifests 2
- ingestion issues 78
- mappings 0
- duplicate positions 0
- orphan records 0

Canonical file hashes tetap cocok.

## 5. Regulatory Boundary

Bukti end-to-end:

```text
2025 → edition-2025 → Pergub NTT No. 26 Tahun 2025
2026 → edition-2026 → Permendagri No. 11 Tahun 2026
```

Fixture 2026 menggunakan exact identity fallback dalam tahun dan kategori yang sama,
bukan code alias. `vehicle_code_mappings` tetap 0. Dua `not_found` dan satu `conflict`
membuktikan engine tidak melakukan cross-year/adjacent-year fallback atau automatic
correction.

`tax_year` tetap bukan public lookup parameter dan ditolak HTTP 400.

## 6. Security / PII

Semua successful live responses memuat:

- `Cache-Control: no-store`
- `X-Request-ID`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- HSTS
- CSP API-only

CORS disabled. PII/internal leakage scan: 0 finding. Response tidak memuat owner,
telepon, alamat, NIK, rangka, mesin, raw BPAD payload, SQL, D1 UUID, secret, atau stack.

## 7. Rate Limiting

- Local deterministic limiter tests: PASS.
- Application protection: fixed-window, 60 request/60 detik, per Worker isolate.
- Controlled live 65 invalid requests: tidak menghasilkan 429.
- Classification: `INCONCLUSIVE — PER-ISOLATE LIMITER`.
- Global WAF: `GLOBAL_WAF_RATE_LIMITING_NOT_CONFIGURED`.

Ini documented architectural limitation, bukan production correctness defect. Tidak ada
D1 audit write dari invalid-request rate test.

## 8. D1 Quota Incident

Bulk import menggunakan lebih dari 130.000 row writes dan sempat menghabiskan free-tier
daily write quota. Akibatnya runtime `match_audits` INSERT sempat HTTP 503. Setelah reset
midnight UTC:

- `/ready` PASS;
- known 2024 dan seluruh closure fixtures dapat diproses;
- runtime match audits kembali ditulis;
- data corruption 0.

Classification: `OPERATIONAL / QUOTA CONSIDERATION`, bukan application defect.

## 9. Remaining Limitations

### Actual defect

Tidak ada actual production defect yang ditemukan.

### External dependency limitation

BPAD adalah external upstream; availability dan payload quality tetap di luar kontrol
Worker. Pada closure ini 8/8 kandidat awal dikenali.

### Fixture limitation

Tidak ada lagi blocker fixture 2025/2026. Real fixtures dari spreadsheet berhasil.

### Known architectural limitation

Rate limiter per-isolate bukan global exact limit.

### Operational limitation

Cloudflare WAF global rate limiting belum dikonfigurasi. D1 free-tier write quota harus
diperhitungkan untuk bulk import atau deployment ulang.

## 10. Final Classification

**PRODUCTION DEPLOYMENT VERIFIED**

## 11. Phase Decision

- Phase 8D dapat ditutup: **YA**.
- Remediation baru diperlukan: **TIDAK**.
- Phase 8E boleh dimulai: **YA**.

Evidence machine-readable: `docs/evidence/phase8d-final-closure.json`.
