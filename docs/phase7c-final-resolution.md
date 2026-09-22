# Phase 7C — Final Unresolved Source Position Resolution

Date: 21 September 2026.

## Status

**PHASE 7C COMPLETE**

All 306 Phase 7B unresolved positions received a source-backed terminal disposition.
No unresolved source positions remain. No value was inferred from adjacent years,
vehicle trends, BPAD data, or another regulation.

## Pergub NTT 26/2025

Physical inspection used both the PDF text layer and rendered official pages 12–13.
Page 12 ends with section A.1 sequence 91; page 13 begins with sequence 192. The
right-hand portion of page 12 is the remaining columns of rows 43–91, not rows
92–191. Therefore 92–191 are an authoritative `SOURCE_NUMBERING_GAP`.

```text
62,256 EXPECTED
= 62,091 VALID
+      3 DUPLICATE
+     14 CONFLICT
+     48 INVALID
+      0 OUT_OF_SCOPE
+      0 SKIPPED_WITH_REASON
+    100 SOURCE_NUMBERING_GAP
+      0 UNRESOLVED
```

Gap evidence stored per source position includes document SHA-256, section, pages
12–13, previous sequence 91, next sequence 192, missing range 92–191, and physical
inspection result.

## Permendagri 11/2026

The 206 Phase 7B unresolved positions were grouped by OCR pattern before source
verification. Systematic parser changes included stricter numeric grouping, rejection
of merged OCR columns, explicit source DPP preservation, and removal of automatic
DPP replacement. A 3× OCR pass was tested but produced more noise and fewer valid
rows than the pinned 2× asset, so it was not adopted.

Every residual non-conflict row was directly inspected on the rendered official PDF.
Source-backed corrections are stored in:

`fixtures/extraction/permendagri-11-2026.corrections.json`

The artifact contains 43 row-keyed corrections, including the original Phase 7B
corrections, all 23 formerly missing OCR rows, the eight source values requiring
published nearest-rupiah DPP, the two malformed NJKB reads, the low-confidence row,
and the established 2026 regulatory smoke row.

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

The conservative invalid count retains OCR-only rows that cannot be proven from the
source-backed correction inventory. They remain in QA but never become active NJKB
references.

## Final artifacts

| Artifact | SHA-256 |
|---|---|
| Pergub canonical | `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c` |
| Pergub QA | `0688c6a496979cdce6276035507c4d6d68cbdf1d783f0abf338aa82b326d78ee` |
| Permendagri canonical | `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e` |
| Permendagri QA | `33967246042edfa47b96789d2722b1558d2c92684244be5525b7141b7b9a67b5` |
| Permendagri corrections | `a13ac81edba7049534f352d85a7eab7578d6492b00cca4116de68a4e0c6c8ff9` |
| Deterministic sample QA | `1a56cd6c7b5215c1a5bb0e072b3807647ae8e2affd2fbe7a92ca2f79aedefa5c` |

## Local D1 reconciliation

Fresh local D1 was rebuilt from migrations `0001`–`0005` without fixture seeding.

```text
canonical importable records = 62,091 + 2,783 = 64,874
njkb_references              = 64,874
ingestion_records            = 64,874
ingestion_manifests          = 2 completed
ingestion_issues             = 78
vehicle_code_mappings        = 0
```

Both repeated imports returned `already_imported`; counts and hashes did not change.

## Validation

- TypeScript: PASS
- Vitest: 96/96 PASS
- Build: PASS
- Production canonical validation: PASS
- Local D1 reconciliation: PASS
- Deterministic sample QA: 40/40 PASS
- Exact code index: `idx_njkb_code`
- Exact identity index: `idx_njkb_identity`
- Regulatory smoke matches 2022–2026: PASS
- Public `tax_year` rejection: retained
- Production deployment: not performed
- Phase 8: not started
