# Phase 7 — Full NJKB Extraction, Validation, and Import

Date: 20 September 2026.

## Scope and authority boundary

Phase 7 extracts Appendix A NJKB vehicle rows only. It does not change the Phase 6
regulatory model:

- `vehicle_year <= 2025` → Pergub NTT No. 26 Tahun 2025
- `vehicle_year = 2026` → Permendagri No. 11 Tahun 2026

`tax_year` remains edition provenance, not a public API parameter. No cross-year
fallback, interpolation, fuzzy automatic match, or automatic code crosswalk is added.

## Sources

| Source | SHA-256 | PDF pages | Table pages |
|---|---|---:|---:|
| Pergub NTT 26/2025 | `94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18` | 690 | 11–622 |
| Permendagri 11/2026 | `7275fd53416f1880b818dfc74b108d53eb3af3ab896fb3cffec2a333c45be638` | 73 | 14–71 |

Source PDFs are local extraction inputs and are not committed. Every extractor checks
the PDF hash before processing.

## Extraction methods

### Pergub NTT 26/2025

The official PDF contains a text table. The document-specific extractor scans the
complete Appendix A range, tracks section/category boundaries and source row
sequences, preserves raw displayed cells, and emits a canonical JSON plus QA JSON.
Non-numeric, missing, or conflicting source rows are kept in QA and excluded from
canonical import.

### Permendagri 11/2026

Pages 14–71 are scanned. A pinned `@gutenye/ocr-node` line-box asset is committed at
`fixtures/extraction/permendagri-11-2026.ocr.jsonl`. The deterministic extractor:

1. verifies the PDF and OCR asset hashes;
2. processes all Appendix A categories A.1–A.15;
3. preserves raw OCR lines, confidence, inferred row position, and corrections in QA;
4. validates year, code, money, weight, and exact DPP arithmetic;
5. rejects ambiguous OCR without guessing.

Pages 72–73 are sections B/C and are outside NJKB Appendix A scope.

## Canonical and QA artifacts

- `fixtures/canonical/pergub-ntt-26-2025.full.json`
- `fixtures/canonical/permendagri-11-2026.full.json`
- `docs/evidence/pergub-ntt-26-2025.extraction-qa.json`
- `docs/evidence/permendagri-11-2026.extraction-qa.json`

Verified Phase 6 fixtures remain unchanged as small manually reviewed regression
evidence. Generated full datasets do not replace them.

## Validation and data-quality rules

- `raw.NO` must equal `source.source_row`.
- Full source codes must remain strings so leading zeroes cannot be lost.
- Every record must fall inside persisted edition year scope.
- Same code/year with conflicting identity is blocking.
- Same code/year/identity with conflicting NJKB is blocking.
- Different codes sharing exact identity are review warnings, not mappings.
- Exact source-position duplicates are blocking.
- Raw/source provenance changes cannot be accepted as `unchanged`.
- DPP must equal NJKB × weight with exact integer arithmetic.

Migration `0005_phase7_edition_scope.sql` adds `vehicle_year_min` and
`vehicle_year_max` to `reference_editions` plus D1 triggers. This prevents invalid
rows even when SQL bypasses the TypeScript validator.

## Reproduction

```sh
node --import tsx scripts/phase7/extract-pergub-ntt-26-2025.ts \
  --pdf path/to/pergub.pdf \
  --output fixtures/canonical/pergub-ntt-26-2025.full.json \
  --qa docs/evidence/pergub-ntt-26-2025.extraction-qa.json

node --import tsx scripts/phase7/extract-permendagri-11-2026.ts \
  --pdf path/to/permendagri.pdf \
  --ocr fixtures/extraction/permendagri-11-2026.ocr.jsonl \
  --output fixtures/canonical/permendagri-11-2026.full.json \
  --qa docs/evidence/permendagri-11-2026.extraction-qa.json
```

Run imports only against a fresh migrated local D1 state:

```sh
npm run db:migrate
npm run import:njkb -- fixtures/canonical/pergub-ntt-26-2025.full.json
npm run import:njkb -- fixtures/canonical/permendagri-11-2026.full.json
npm run phase7:verify:local -- \
  fixtures/canonical/pergub-ntt-26-2025.full.json \
  fixtures/canonical/permendagri-11-2026.full.json
```

Importing the same canonical file again must return `already_imported`, with zero
insertions and all rows reported unchanged.

## Current extraction status

Pergub Appendix A: 62,127 expected sequence rows; 62,047 detected; 61,805 canonical
validated/imported; 242 detected rows rejected and 80 sequence rows absent from the
text extraction. Exceptions include 194 source rows with blank DPP, 34 hash/malformed
money rows, and 14 rows in seven source conflicts. Because unresolved rows remain,
Source A is a validated partial import rather than a complete Phase 7 acceptance.

Permendagri Appendix A: 3,080 expected source rows; 2,715 canonical validated/imported;
365 ambiguous rows plus one unassigned OCR line retained in QA and withheld. Because
unresolved rows remain, Source B is also a validated partial import.

Local D1 contains 64,520 references and matching ingestion records, two completed
manifests, 16 persisted duplicate warnings, zero automatic code mappings, and no
out-of-scope rows. Both imports are idempotent. Full per-year/category/brand coverage
is stored in `docs/evidence/phase7-coverage-summary.json`.

Phase 7A did not meet the strict full-completeness acceptance criterion. Phase 7B
superseded the baseline counts, and Phase 7C resolved the final disposition backlog.
See `docs/phase7c-final-resolution.md`. No production deployment was performed.

No production deployment was performed.
