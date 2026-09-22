# Phase 6 — Regulatory Resolution

Resolution date: **20 September 2026**.

## 1. Keputusan Regulatory Final

Phase 6 menetapkan boundary resolusi regulatory sebagai berikut:

| vehicle_year | Regulatory edition | Jurisdiction | applicability_status |
|---:|---|---|---|
| ≤ 2025 | Pergub NTT No. 26 Tahun 2025 | NTT | approved |
| 2026 | Permendagri No. 11 Tahun 2026 | ID | approved |

Keputusan ini final. Tidak diperlukan pencarian instrumen NTT 2026 tambahan.

## 2. Prinsip Utama

- `vehicle_year` adalah lookup dimension utama. `tax_year` bukan parameter lookup publik.
- Tidak ada cross-tier fallback: kendaraan pre-2026 tidak boleh diresolusi dari edisi nasional 2026, dan sebaliknya.
- Tidak ada cross-year substitution: kendaraan tahun 2024 tidak boleh menggunakan reference tahun 2023, 2025, atau 2026.
- Tidak ada automatic code alias: `701167 08549` dan `701167 67749` tetap independent.
- Fuzzy matching hanya sebagai review candidate, bukan automatic public resolution.

## 3. Matching Hierarchy (dalam setiap tier)

1. Exact full KODING + vehicle_year
2. Exact normalized brand + type + vehicle_year + vehicle_category
3. Verified vehicle_code_mapping
4. Fuzzy similarity → review only, tidak ada NJKB publik

## 4. Regulatory Boundary Implementation

Matching engine menentukan tier berdasarkan vehicle_year sebelum melakukan lookup:

```
vehicle_year <= 2025 → tier: [NTT approved editions]
vehicle_year = 2026  → tier: [ID approved editions]
```

Tidak ada fallback antar-tier. Jika tier yang sesuai tidak memiliki coverage untuk
vehicle_year/category tersebut: `reference_unavailable`.

## 5. Status Setiap Edition

### Pergub NTT No. 26 Tahun 2025

- Jurisdiction: NTT
- applicability_status: **approved**
- effective_from: 2025-06-13
- Scope: vehicle_year ≤ 2025
- SHA-256: `94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18`
- Official PDF: https://peraturan.bpk.go.id/Download/401313/Pergub.%20NTT%20No.%2026%20Tahun%202025.pdf

Catatan: Pergub ini mengandung vehicle_year hingga 2025 (page 503, rows 5308–5311 untuk
kode 701167 08549). Terdapat inkonsistensi heading Pasal 20/Appendix A yang menyebut
"sebelum 2025" tetapi tabel secara fisik mengandung baris 2025; inkonsistensi ini
didokumentasikan dan tidak diselesaikan secara otomatis.

### Permendagri No. 11 Tahun 2026

- Jurisdiction: ID (national)
- applicability_status: **approved**
- effective_from: 2026-04-01
- Scope: vehicle_year = 2026
- SHA-256: `7275fd53416f1880b818dfc74b108d53eb3af3ab896fb3cffec2a333c45be638`
- Official catalog: https://jdih.kemendagri.go.id/dokumen/view?id=2060

Pasal 27 mendelegasikan pre-2026 values ke Pergub masing-masing provinsi.
Appendix A hanya mengandung vehicle_year 2026.

## 6. Kode Identity

| Source code | Regulation | vehicle_year coverage | Auto crosswalk |
|---|---|---|---|
| 701167 08549 | Pergub NTT 26/2025 | 2022, 2023, 2024, 2025 | Tidak |
| 701167 67749 | Permendagri 11/2026 | 2026 | Tidak |

Kedua kode tidak memiliki automatic crosswalk. Matching menggunakan exact code
terlebih dahulu; jika gagal, exact identity (brand + type + year + category) digunakan.

## 7. Verified Evidence

Semua bukti fisik tersimpan di `docs/evidence/phase5-regulatory-evidence.json`.

| Dokumen | Page | Row | KODING | MERK | TYPE | TAHUN BUAT | NJKB |
|---|---:|---|---|---|---|---:|---:|
| Pergub NTT 26/2025 | 503 | 5308 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2022 | 11,700,000 |
| Pergub NTT 26/2025 | 503 | 5309 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2023 | 11,900,000 |
| Pergub NTT 26/2025 | 503 | 5310 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2024 | 12,500,000 |
| Pergub NTT 26/2025 | 503 | 5311 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2025 | 12,600,000 |
| Permendagri 11/2026 | 55 | 311 | 701167 67749 | HONDA | C1M02N42L1 A/T | 2026 | 12,900,000 |

## 8. Perubahan Code/Database Phase 6

- `fixtures/verified.json`: edition-2025 diubah dari `historical` ke `approved`;
  ditambahkan fixture rows untuk vehicle_year 2022 (fixture-a2022), 2023 (fixture-a2023),
  dan 2025 (fixture-a2025).
- `migrations/0004_vehicle_year_resolution.sql`: ditambahkan UPDATE untuk
  mempromosikan Pergub NTT 26/2025 ke `approved`.
- `src/matching/engine.ts`: ditambahkan fungsi `regulatoryTiersForYear` yang
  menentukan tier authority berdasarkan vehicle_year sebelum lookup; tidak ada
  cross-tier fallback.
- `fixtures/canonical/pergub-ntt-26-2025.sample.json` dan `.csv.manifest.json`:
  applicability_status diubah dari `historical` ke `approved`.
- `tests/database.test.ts`, `tests/matching.test.ts`, `tests/api.test.ts`:
  diperbarui untuk Phase 6 acceptance criteria.
- `README.md`: diperbarui untuk mencerminkan regulatory model final.
- `docs/phase6-regulatory-resolution.md`: dokumen ini.

Tidak ada migration baru yang dibuat pada Phase 6. Phase 7 kemudian menambahkan
migration `0005_phase7_edition_scope.sql` untuk mempersistenkan dan menegakkan scope
`vehicle_year_min`/`vehicle_year_max` pada database. Boundary regulatory tetap sama.

## 9. Status Full Dataset Phase 7

- Pergub NTT 26/2025: extraction pages 11–622; hasil dan exception tercatat pada
  `docs/evidence/pergub-ntt-26-2025.extraction-qa.json`.
- Permendagri 11/2026: OCR pages 14–71; 2,715 baris canonical tervalidasi dan 366
  baris ambiguous/unassigned ditahan dari import tanpa tebakan. Detail raw OCR dan
  alasan ada di `docs/evidence/permendagri-11-2026.extraction-qa.json`.
- Full dataset tidak menggantikan verified fixtures. Fixtures tetap bukti regresi
  manual, sedangkan full canonical datasets memiliki manifest dan hash tersendiri.
- Phase 7C menetapkan final reconciliation menjadi 62.091 importable Pergub records
  dan 2.783 importable Permendagri records. Pergub rows 92–191 adalah verified
  `SOURCE_NUMBERING_GAP`; seluruh residual Permendagri memiliki terminal disposition.
  Tidak ada source position yang tetap `UNRESOLVED`.
- Tidak ada automatic code mapping yang dibuat.

Tidak ada deployment production yang dilakukan.
