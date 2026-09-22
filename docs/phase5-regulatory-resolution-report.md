# Phase 5 — Regulatory Resolution Report

Research cut-off and resolution date: **20 September 2026**.

## 1. Ringkasan Temuan

Phase 5 confirms that `vehicle_year`/`TAHUN_BUAT`, together with vehicle identity, is the lookup dimension. A regulation year remains provenance and an edition attribute; it is not a public lookup parameter.

The official evidence does not fully support the originally proposed “Pergub 26/2025 first for every lookup” rule in the current 2026 context:

- Pergub NTT 26/2025 contains historical NJKB evidence through vehicle year 2025, including the verified 2024 test row.
- Permendagri 11/2026 Appendix A covers vehicle year 2026. Article 27 requires pre-2026 values to be set by a Governor Regulation after central approval; Article 28 states that the prior governor-set bases cease to apply and must be adjusted.
- The official NTT JDIH 2026 Pergub catalog did not reveal the required adjusted 2026 provincial instrument as of the research cut-off. Therefore pre-2026 rows are retained as historical evidence but are not automatically returned as current authoritative values.
- Vehicle year 2026 may resolve from Permendagri 11/2026 when the year and identity match exactly.

Consequently, DH4786PD's 2024 row is visually verified as `Rp12,500,000`, but current operational resolution returns `reference_unavailable` until the applicable adjusted NTT instrument is obtained. This is deliberate evidence conservatism, not deletion of the historical row.

## 2. Prinsip Lookup NJKB

- Primary dimension: `vehicle_year`, full source code, brand, type, and vehicle category.
- `tax_year` is not accepted by `GET /api/njkb/{nopol}`.
- `tax_year` remains in edition/reference/import tables solely as legacy-compatible edition provenance.
- `resolution_as_of` is server-controlled authority metadata used to determine which approved sources are effective. It is not supplied by a client and is not a substitute for `vehicle_year`.
- No reference may cross vehicle years.
- No interpolation, extrapolation, depreciation, market-price estimate, or automatic alias is allowed.

## 3. Pergub NTT No. 26 Tahun 2025

### Ruang lingkup

The official BPK catalog identifies the regulation as the 2025 basis for PKB, BBNKB, and PAB in NTT. It was set, promulgated, and effective on 13 June 2025, contains a 10-page body and a 680-page appendix, and revokes Pergub 47/2024.

Official sources:

- Catalog: https://peraturan.bpk.go.id/Details/338242/pergub-prov-nusa-tenggara-timur-no-26-tahun-2
- PDF: https://peraturan.bpk.go.id/Download/401313/Pergub.%20NTT%20No.%2026%20Tahun%202025.pdf
- SHA-256: `94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18`

### Struktur tabel

Appendix A uses `NO`, `KODING`, `MERK`, `TYPE`, `TAHUN BUAT`, `NJKB`, `BOBOT`, and `DP PKB`. Article 7 defines DPP PKB as NJKB multiplied by weight. Article 17 provides a government procedure for types/years absent from the table; the API does not emulate that administrative power.

### Cakupan TAHUN BUAT

Inspection of physical PDF pages 11–629 found parseable vehicle years from 1940 through 2025. Rows with 2025 are visibly present; no 2026 row was found in this range. This is coverage observed in the source PDF, not a full extraction/import claim.

There is an internal source inconsistency that must remain documented: Article 20 and the Appendix A heading on physical page 11 say “pembuatan sebelum tahun 2025”, yet the physical tables contain vehicle-year 2025 rows, including on page 503 and at the end of the inspected range. The system preserves row-level evidence and does not silently reinterpret the heading.

### Evidence test case DH4786PD

Physical PDF page 503 visibly contains:

| Source row | KODING | MERK | TYPE | TAHUN BUAT | NJKB | BOBOT | DP PKB |
|---:|---|---|---|---:|---:|---:|---:|
| 5308 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2022 | 11,700,000 | 1 | 11,700,000 |
| 5309 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2023 | 11,900,000 | 1 | 11,900,000 |
| 5310 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2024 | 12,500,000 | 1 | 12,500,000 |
| 5311 | 701167 08549 | HONDA | C1M02N42L1 A/T | 2025 | 12,600,000 | 1 | 12,600,000 |

The 2024 value is confirmed as historical row evidence with page and row provenance.

### Applicability and known limitations

The BPK catalog labels Pergub 26/2025 as in force, but Permendagri 11/2026 Article 28 specifically states that previously set governor bases cease to apply and must be adjusted. Those official signals differ in granularity. For current 2026 resolution the implementation follows the newer, specific rule conservatively: the Pergub edition is `historical`, not `approved`.

`NOT_FOUND`: no 2026 NTT Pergub adjusting the basis was found after reviewing all 28 titles across the three official 2026 catalog pages. This does not prove that no differently indexed or unpublished instrument exists.

## 4. Permendagri No. 11 Tahun 2026

### Ruang lingkup and legal relationship

The inspected 73-page document was enacted on 1 April 2026. Articles 14–18 regulate the bases for PKB/BBNKB and place the 2026 NJKB/NJMKB in the appendix. Article 27 delegates values for vehicles made before 2026 to Governor Regulations after central approval. Article 28 requires governors to adjust their prior bases within 15 working days. Article 29 revokes Permendagri 7/2025.

Official catalogs:

- JDIH Kemendagri: https://jdih.kemendagri.go.id/dokumen/view?id=2060
- Ditjen Bina Keuangan Daerah: https://keuda.kemendagri.go.id/produkhukum/bytahun/3/2026
- Inspected document SHA-256: `7275fd53416f1880b818dfc74b108d53eb3af3ab896fb3cffec2a333c45be638`

### Struktur dan cakupan TH BUAT

Appendix A, observed on physical pages 14–71, uses `NO`, `KODING`, `MEREK`, `TYPE`, `TH BUAT`, `NJKB`, `BOBOT`, and `DP PKB`. OCR identified 1,085 candidate data rows. Visual checks of the first, intermediate, test-case, and final table pages show vehicle year 2026. One OCR token appeared as `2096`; the rendered source visibly says `2026`. The observed Appendix A coverage is therefore 2026 only.

### Evidence kendaraan produksi 2026

Physical page 55, source row 311 visibly confirms:

| KODING | MEREK | TYPE | TH BUAT | NJKB | BOBOT | DP PKB |
|---|---|---|---:|---:|---:|---:|
| 701167 67749 | HONDA | C1M02N42L1 A/T | 2026 | 12,900,000 | 1.0 | 12,900,000 |

This is an approved national 2026 reference. It does not establish that `701167 67749` is an alias of `701167 08549`.

### Known limitations

- Appendix A does not provide the observed pre-2026 coverage needed for current lookup; Article 27 assigns that work to the Governor Regulation.
- Article 23 permits ministerial updates for missing entries. The local dataset must import such updates as separate, hashed source evidence; it may not invent them.
- The JDIH landing page was discoverable but intermittently unavailable to automated retrieval during research. The supplied document was therefore hashed and visually inspected, and both official catalog URLs are retained.

## 5. Resolution Matrix

This matrix distinguishes row coverage from current applicability.

| TAHUN_BUAT | Pergub 26/2025 evidence | Permendagri 11/2026 evidence | Current resolution as of 2026-09-20 |
|---:|---|---|---|
| 2022 | Verified for the test type, p.503 row 5308 | No pre-2026 row observed; Article 27 delegates to Pergub | `reference_unavailable`; historical row retained |
| 2023 | Verified for the test type, p.503 row 5309 | No pre-2026 row observed; Article 27 delegates to Pergub | `reference_unavailable`; historical row retained |
| 2024 | Verified for the test type, p.503 row 5310 | No pre-2026 row observed; Article 27 delegates to Pergub | `reference_unavailable`; historical row retained |
| 2025 | Verified for the test type, p.503 row 5311; 2025 rows visibly occur elsewhere | No pre-2026 row observed; Article 27 delegates to Pergub | `reference_unavailable`; historical row retained |
| 2026 | No 2026 row observed | Verified, including p.55 row 311 | Permendagri if exact year and identity match |

For vehicle years outside a proven approved edition/category range, the result is `reference_unavailable`, not `not_found`. `not_found` is reserved for a vehicle year/category that is covered by an approved dataset but lacks an identity match.

## 6. Matching Rules

Within each approved authority tier:

1. exact normalized full `KODING` + exact `vehicle_year`;
2. exact normalized `MERK` + `TYPE` + `vehicle_year` + `vehicle_category`;
3. explicitly verified code crosswalk with document evidence;
4. fuzzy similarity only as review candidates, never an automatic NJKB.

An approved NTT edition takes precedence over an approved national edition. The national tier is used only when the provincial tier has no match. Multiple exact rows produce `ambiguous`; a code hit whose identity disagrees produces `conflict`.

## 7. Fallback Rules

- Fallback is between approved regulatory authority tiers, not between vehicle years.
- A 2026 vehicle must not use a 2025 row; a 2024 vehicle must not use a 2026 row.
- No calculation or substitution is permitted when authoritative coverage is absent.
- If no approved edition covers the exact vehicle year and category: `reference_unavailable`.
- If coverage exists but no exact/verified match exists: `not_found`; fuzzy candidates may be recorded only for review.

## 8. Provenance Rules

Every reference retains:

- regulation kind, number, year, title, jurisdiction, and effective dates;
- reference edition and applicability status/note;
- source document URL/identity, SHA-256, filename, acquisition method, and page count;
- source PDF page, source row, section, and source code;
- raw values, normalized values, normalization version, extraction method/tool, and review status;
- integer rupiah and fixed-point weight (`weight_micros`), never floating point.

The evidence snapshot for this phase is machine-readable at `docs/evidence/phase5-regulatory-evidence.json`.

## 9. Regulatory Gaps

1. **Current NTT pre-2026 basis — NOT_FOUND.** The adjusted 2026 Pergub required by Permendagri Articles 27–28 was not found in the official 2026 JDIH catalog.
2. **Pergub heading/table inconsistency — CONFIRMED.** “Before 2025” wording conflicts with visible 2025 rows.
3. **Catalog status tension — UNCERTAIN.** BPK metadata says Pergub 26/2025 is in force, while the newer Permendagri invalidates prior governor-set bases. The conservative resolver does not treat the historical values as current.
4. **Official code crosswalk — NOT_FOUND.** No evidence maps `701167 08549` to `701167 67749`.
5. **Complete year/category coverage — NOT ASSESSED.** Phase 5 sampled and measured source coverage but intentionally did not perform full extraction/import.
6. **Ministerial updates under Article 23 — NOT_FOUND.** No separate update instrument was included in the audited project evidence.

## 10. Dampak terhadap Phase 6

Before importing a current pre-2026 production reference, Phase 6 must obtain and hash the adjusted NTT instrument or other authoritative approval evidence required by Article 27. It should then:

- create a new source document and edition instead of overwriting Pergub 26/2025 history;
- set applicability only after legal/evidence review;
- import rows through the Phase 4 validated pipeline;
- test category/year coverage explicitly;
- keep both Honda codes independent unless an official crosswalk is later found;
- retain `reference_unavailable` for unresolved gaps.

Phase 6 must not begin from an assumption that the historical 2025 provincial edition remains the current 2026 basis.

## 11. Perubahan Code/Database yang Dilakukan

Changes were minimal and isolated to resolution semantics:

- public `tax_year` query removed; any query parameter is rejected;
- matching engine now starts with BPAD `vehicle_year` and server-side `resolution_as_of`;
- repository selects approved/effective editions by jurisdiction and date, then verifies actual year/category row coverage;
- authority order is approved NTT then approved national;
- new migration changes `match_audits.requested_tax_year` to `resolution_as_of`, retaining the old value only as legacy migration metadata;
- migration adds edition-resolution and year/category coverage indexes;
- Permendagri 11/2026 edition is marked approved for its evidenced 2026 coverage; Pergub 26/2025 remains historical;
- responses now use `reference_unavailable` and no longer expose `tax_year`;
- no schema field was added for invented aliases and no mapping rows were created.

No full extraction, full import, public deployment, or Phase 6 work was performed.

## 12. Test Results

Commands:

```text
npm run typecheck
npm test -- --run
npm run build
```

Result at completion:

- TypeScript: PASS
- Vitest: **5 files, 64 tests, all PASS**
- Phase 1–4 database, ingestion, BPAD adapter, matching, and API regressions: PASS
- New Phase 5 coverage includes current 2024 unavailability, exact 2026 resolution, no code alias, no cross-year substitution, authority-date edition selection, public `tax_year` rejection, conflict, ambiguity, fuzzy-review-only, and minimal audit data.
- Local D1 migration/seed/inspection: PASS; both fixture rows remain separate.
- Local mock HTTP smoke test: 2024 `reference_unavailable`, 2026 `matched`, and `?tax_year=2026` rejected.
- Wrangler dry-run: PASS; no deployment was performed.

## 13. Kesimpulan Phase 5

The resolution model is now evidence-aligned: exact vehicle identity plus `vehicle_year` selects an approved, effective source; regulation year remains provenance. The 2024 Honda value of `Rp12,500,000` is preserved and traceable as historical Pergub evidence, while the current system refuses to present it as a proven 2026 value. The 2026 Honda row resolves to `Rp12,900,000` from Permendagri 11/2026 when its exact year and identity match.

`701167 08549` and `701167 67749` remain separate codes. There is no cross-year substitution, estimation, automatic fuzzy result, or automatic code alias. The project stops at Phase 5.
