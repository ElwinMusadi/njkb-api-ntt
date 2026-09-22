# Phase 5 verification

Final verification date: 20 September 2026. No live BPAD request, remote D1 write,
production deployment, full PDF extraction, or Phase 6 import was performed.

| Command/check | Result |
|---|---|
| `npm run db:migrate` | Migration 0004 applied successfully to local D1 |
| `npm run db:seed` | Two verified fixtures retained idempotently |
| `npm run db:inspect` | 2024/`701167 08549` and 2026/`701167 67749` remain separate |
| `npm run typecheck` | PASS |
| `npm test -- --run` | 5 files, 64 tests passed, 0 failed |
| `npm run build` | Wrangler dry-run PASS; no deployment |
| local mock HTTP smoke test | 2024 unavailable; 2026 matched; public `tax_year` rejected |

Test distribution:

- 19 database/provenance/resolution tests;
- 16 ingestion tests;
- 12 public API tests;
- 10 matching/resolution tests;
- 7 BPAD adapter tests.

Phase 5-specific coverage proves:

- current 2024 lookup does not return the historical Pergub value;
- exact 2026 source-code/year lookup returns the Permendagri value;
- the two source codes are not aliased;
- no cross-year substitution occurs;
- approved editions are selected by internal authority date, not client tax year;
- fuzzy candidates do not return NJKB;
- unsupported `tax_year` queries are rejected;
- match audits contain `resolution_as_of` and minimal normalized vehicle identity.

The shipped dataset remains a two-row verified sample, not a complete extraction of
either regulation. Complete extraction/import remains outside Phase 5.
