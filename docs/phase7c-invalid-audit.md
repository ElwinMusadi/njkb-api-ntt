# Pre-Phase 8 Invalid Audit — Permendagri 11/2026

Date: 22 September 2026.

## 1. Executive Summary

- Audited records: **285**
- Recoverable: **0**
- Remained invalid: **285**
- Changed to conflict: **0**
- Changed to duplicate: **0**
- Other disposition: **0**
- Unresolved: **0**

This audit performed an exhaustive source-fidelity and data-quality inspection of all 285 `INVALID` records in Permendagri No. 11 Tahun 2026 Appendix A following the Phase 7C baseline.

The audit confirms that all 285 records are legitimately classified as `INVALID`. They suffer from merged OCR columns, punctuation/separator corruption in money strings, missing decimal separators in vehicle weights, or irreconcilable arithmetic conflicts between printed/parsed NJKB, weight, and DP PKB. Converting any of these records to `VALID` through heuristic parser loosening would re-introduce data fabrication and identity corruption (such as merged numbers, truncated values, or misspelled brands). Retaining them as `INVALID` ensures that only verified, uncorrupted records enter active NJKB references while maintaining 100% auditable accounting.

## 2. Root Cause Distribution

| Root Cause | Count | Recovered | Remained Invalid | Description |
|---|---:|---:|---:|---|
| `MERGED_OCR_COLUMNS` | 121 | 0 | 121 | Whitespace or merged column text inside numeric groupings (e.g. `274,947 750`, `1 152,900;000`). |
| `OCR_PUNCTUATION_CORRUPTION` | 64 | 0 | 64 | Hyphens, colons, semicolons, or underscores inside monetary values (e.g. `11.500-000.000`, `1.240-000.000`). |
| `MALFORMED_WEIGHT` | 61 | 0 | 61 | Weight strings lacking standard decimal punctuation (e.g. `1050`, `10`, `14`), preventing deterministic decimal interpretation. |
| `SOURCE_ARITHMETIC_CONFLICT` | 36 | 0 | 36 | Parsed NJKB, weight, and DP PKB exhibit mathematical disagreement (`NJKB × BOBOT ≠ DP_PKB`), even after nearest-rupiah rounding. |
| `MALFORMED_NJKB` | 3 | 0 | 3 | Omitted thousand-separator dots resulting in digit blocks exceeding 3 digits (e.g. `2.851425.000`, `1.012000.000`). |
| **Total** | **285** | **0** | **285** | |

## 3. Source Verification

- Pages inspected: Official PDF pages 14–71 (Appendix A table range)
- Records inspected: All 285 `INVALID` records individually evaluated via OCR text and rendered page verification
- Records corrected: 0 (the 43 legitimate source-backed corrections established in Phase 7C remain active and sufficient)
- Records retained invalid: 285
- Evidence coverage: 100% of invalid rows have documented page, row, bounding box, raw OCR text, confidence score, and specific failure reason in `docs/evidence/permendagri-11-2026.extraction-qa.json` and `docs/evidence/phase7c-invalid-audit.json`.

Inspection confirmed that the scanned 200 DPI photocopy nature of the source document introduces localized visual blurring and character degradation in these rows. Without an authoritative machine-readable digital layer, attempting to guess missing punctuation or recompute conflicting numbers would violate regulatory integrity.

## 4. Corrections

No new corrections were made during this audit. The 43 row-keyed, source-backed corrections established in Phase 7C and stored in `fixtures/extraction/permendagri-11-2026.corrections.json` remain authoritative, reproducible, and unchanged:
- A.1 row 120 (page 16) — VOLVO ES90
- A.2 row 90 (page 18) — JETOUR T1
- A.3 row 339 (page 26) — MAZDA CX-60
- A.13 row 311 (page 55) — HONDA C1M02N42L1 A/T (regulatory smoke row)
- 23 previously missing OCR rows visually verified and reconstructed
- 8 source-published nearest-rupiah rounding rows preserved as printed
- 7 additional visually verified table repairs

No speculative or heuristic corrections were admitted.

## 5. Final Disposition

| Disposition | Before Audit | After Audit | Delta |
|---|---:|---:|---:|
| `VALID` | 2,783 | 2,783 | 0 |
| `DUPLICATE` | 0 | 0 | 0 |
| `CONFLICT` | 12 | 12 | 0 |
| `INVALID` | 285 | 285 | 0 |
| `SOURCE_NUMBERING_GAP` | 0 | 0 | 0 |
| `OUT_OF_SCOPE` | 0 | 0 | 0 |
| `SKIPPED_WITH_REASON` | 0 | 0 | 0 |
| `UNRESOLVED` | 0 | 0 | 0 |
| **Total** | **3,080** | **3,080** | **0** |

## 6. Reconciliation

The exact sequence reconciliation equation for Permendagri No. 11 Tahun 2026 Appendix A remains 100% balanced:

```text
3,080 EXPECTED
= 2,783 VALID
+     0 DUPLICATE
+    12 CONFLICT
+   285 INVALID
+     0 OUT_OF_SCOPE
+     0 SKIPPED_WITH_REASON
+     0 SOURCE_NUMBERING_GAP
+     0 UNRESOLVED
```

Every expected source position across all 15 vehicle categories (A.1 to A.15) has exactly one mutually exclusive terminal disposition.

## 7. Dataset Hashes

Because no records changed disposition and no heuristic modifications were made, all canonical and QA dataset hashes remain unchanged:

- Canonical Permendagri full dataset:
  `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e` (UNCHANGED)
- Extraction QA Permendagri:
  `33967246042edfa47b96789d2722b1558d2c92684244be5525b7141b7b9a67b5` (UNCHANGED)
- Permendagri corrections artifact:
  `a13ac81edba7049534f352d85a7eab7578d6492b00cca4116de68a4e0c6c8ff9` (UNCHANGED)
- Canonical Pergub full dataset:
  `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c` (UNCHANGED)
- Extraction QA Pergub:
  `0688c6a496979cdce6276035507c4d6d68cbdf1d783f0abf338aa82b326d78ee` (UNCHANGED)

## 8. Database State

Local D1 database state is verified and consistent with the canonical importable datasets:

| Table / Metric | Count |
|---|---:|
| `regulations` | 2 |
| `source_documents` | 2 |
| `reference_editions` | 2 |
| `njkb_references` | 64,874 |
| `ingestion_records` | 64,874 |
| `ingestion_manifests` | 2 (both `completed`) |
| `ingestion_issues` | 78 (all warnings in Pergub; 0 in Permendagri) |
| `vehicle_code_mappings` | 0 |

Active reference count breakdown:
- Pergub NTT 26/2025: **62,091**
- Permendagri 11/2026: **2,783**
- Total: **64,874**

## 9. Tests and Verification

All verification commands executed cleanly:

- `npm run typecheck`: **PASS** (0 errors)
- `npm test`: **PASS** (96/96 tests across 5 test suites)
- `npm run build`: **PASS** (Wrangler dry-run deployment successful)
- Ingestion validation: **PASS** (100% valid records across both canonical datasets)
- Local D1 verification (`scripts/verify-phase7-local.ts`): **PASS**
- Deterministic 40-row sample QA (`scripts/verify-phase7b-samples.ts`): **PASS** (40/40 exact code matches)
- Re-import idempotency: **PASS** (`already_imported`, 0 insertions)
- Query plan verification: **PASS** (`idx_njkb_code` and `idx_njkb_identity` utilized)
- Regulatory smoke tests: **PASS** (2022–2025 -> Pergub; 2026 -> Permendagri)
- Public API contract: **PASS** (`GET /api/njkb/{nopol}` clean; `?tax_year=...` returns HTTP 400)

## 10. Findings

### Confirmed Source Facts
1. The official source document for Permendagri No. 11 Tahun 2026 is a 73-page scanned PDF photocopy without an embedded text layer.
2. The OCR engine (`@gutenye/ocr-node`) successfully extracted 2,783 high-confidence, clean, verified records.
3. The 285 `INVALID` records correspond to physical lines where OCR resolution degraded due to photocopy noise, resulting in unseparated punctuation, merged columns, or conflicting numbers.
4. The 12 `CONFLICT` records represent genuine source instances where the same vehicle code is listed with conflicting brand or type designations.

### Parser Findings
1. The current extraction parser (`scripts/phase7/extract-permendagri-11-2026.ts`) enforces strict validation on currency formatting, weight representations, and DPP arithmetic.
2. Removing these strict guards would artificially inflate `VALID` count while admitting corrupted brands (e.g. `ETOUR`, `SUZU`, `DAHATSU`) and concatenated numeric strings.
3. The conservative parser posture is essential for maintaining production data integrity.

### Audit Decisions
1. Retaining all 285 records as `INVALID` is the correct, evidence-based architectural choice.
2. `UNRESOLVED` remains strictly at `0`.
3. No external data sources or model inferences were used to guess vehicle values.
4. No vehicle code aliases or crosswalks were created.

## 11. Final Recommendation

**AUDIT PASS — READY FOR PHASE 8**
