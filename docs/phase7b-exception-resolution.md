# Phase 7B — Extraction Exception Resolution

Date: 20 September 2026.

## Status

**PHASE 7B — NOT COMPLETE**

Both sources now have exact, disjoint reconciliation and no unknown or silently
dropped source positions. However, 306 source positions remain `UNRESOLVED`. No value
was guessed to eliminate them.

## Pergub NTT 26/2025

Phase 7A used inconsistent hard-coded totals and truncated 95 otherwise valid rows.
Phase 7B derived the section totals from authoritative source sequences, extended the
actual table scope through page 629, and removed positional truncation.

Final equation:

```text
62,256 EXPECTED
= 62,091 VALID
+      3 DUPLICATE
+     14 CONFLICT
+     48 INVALID
+      0 OUT_OF_SCOPE
+      0 SKIPPED_WITH_REASON
+    100 UNRESOLVED
```

Key findings:

- A.1 source sequence jumps from row 91 on PDF page 12 to row 192 on page 13.
  Rows 92–191 are explicitly `UNRESOLVED`; no values were generated.
- All 194 A.5 DPP cells previously reported blank were recovered deterministically
  from split continuation columns on pages 261–263, with exact row-order evidence.
- 34 rows contain literal hash/malformed money cells in the source.
- 14 additional rows have source DPP mismatch.
- Seven code/year conflict groups contain 14 rows and remain inactive.
- Three exact repeated trailing rows were classified `DUPLICATE` and not imported.
- Thirty-nine different-code identity groups remain valid source-backed records;
  they create 78 persisted review warnings but no `vehicle_code_mapping`.

Canonical SHA-256:
`bf7c20d0f10ab2a52f47b1dc40518d5856c02c11eb57e136c05ecbd20581b5da`

QA SHA-256:
`5d6bd2a60a8b3d6eec09ebc1ac5605fc18245eaf2f8ebfa3246f8dc360971236`

## Permendagri 11/2026

Phase 7A treated a document heading as A.1 row 1, displaced later row identities,
and assigned missing rows to the last category page. Phase 7B excludes header noise,
uses explicit source row identity, and provides three rendered-page corrections.

Final equation:

```text
3,080 EXPECTED
= 2,864 VALID
+     0 DUPLICATE
+    10 CONFLICT
+     0 INVALID
+     0 OUT_OF_SCOPE
+     0 SKIPPED_WITH_REASON
+   206 UNRESOLVED
```

Source-backed correction artifact:
`fixtures/extraction/permendagri-11-2026.corrections.json`

Corrections:

- page 16, A.1 row 120 — VOLVO ES90
- page 18, A.2 row 90 — JETOUR T1
- page 26, A.3 row 339 — MAZDA CX-60; OCR year `202G` corrected from rendered source

Canonical SHA-256:
`f58ff28ecc47ec251566d00f7358e5c76ba64c3306f6321c1e4925bc32a8cf97`

QA SHA-256:
`a8a53f8cfd022e708c319a19165225177a2ca1dd07d6ef3b6876c2675307df26`

Correction artifact SHA-256:
`29f9084a9ebef1d1161741641a6df663441399a974685e8059f4dff148e5872e`

## Database reconciliation

A fresh local D1 was rebuilt from migrations `0001`–`0005`, without fixture seeding.

```text
canonical importable records = 62,091 + 2,864 = 64,955
D1 njkb_references          = 64,955
D1 ingestion_records        = 64,955
D1 ingestion_manifests      = 2 completed
D1 ingestion_issues         = 78
D1 vehicle_code_mappings    = 0
```

Both repeated imports returned `already_imported` with zero insertions.

## Deterministic sample QA

`docs/evidence/phase7b-random-sample-qa.json` contains 20 deterministic SHA-ranked
unique-code samples from each edition. All 40 resolved by `exact_code` to the exact
source document, page, and row stored in canonical data.

## Regression and performance

- TypeScript: PASS
- Vitest: 95/95 PASS
- Build: PASS
- Unsupported public `tax_year`: retained
- Cross-year authority boundary: retained
- `idx_njkb_code`: used by exact-code query plan
- `idx_njkb_identity`: used by exact-identity query plan
- Production deployment: not performed
