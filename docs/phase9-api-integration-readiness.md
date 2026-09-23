# Phase 9 — Production API Contract & Integration Readiness Report

Tanggal audit: 23 September 2026.

## 1. Baseline

- Phase 8: COMPLETE
- Phase 8D: `PRODUCTION DEPLOYMENT VERIFIED`
- Phase 8E: `OPERATIONALLY READY WITH ACTION ITEMS`
- Worker version: `20caad97-94f7-442e-a7a6-67a80592d73b`
- Production URL: `https://njkb-api-ntt.elwinmusadi.workers.dev`
- D1: `njkb-api-production` (APAC)
- Baseline Git commit: `2e37d629a05dc700922af3528c1f1e516b9779fa`

Tidak ada runtime Worker, D1, canonical dataset, migration, regulatory, matching, atau
public response behavior yang diubah pada Phase 9.

## 2. Public API Contract

| Item | Current Behavior | Status |
|---|---|---|
| Endpoint | `GET /api/njkb/{nopol}` | PASS |
| Method | GET only; route lain 404 | PASS |
| NOPOL | NFKC, uppercase, whitespace/hyphen removed, strict regex | PASS |
| Query parameters | Semua ditolak HTTP 400; `tax_year` unsupported | PASS |
| Success response | matched atau reference_unavailable (HTTP 200) | PASS |
| Error response | Scenario-specific stable body/status | PASS |
| Monetary representation | Decimal strings; nullable source values | PASS |
| Headers | no-store, request ID, security headers | PASS |
| CORS | Disabled | PASS |
| Authentication | None | DOCUMENTED |
| Rate limiting | 60/60s per client key per isolate; 429 contract | DOCUMENTED LIMITATION |

## 3. Response Schemas

- `matched`: HTTP 200; `nopol`, `vehicle`, `njkb`, `match`, `source`.
- `reference_unavailable`: HTTP 200; `nopol` + `vehicle`; no NJKB/fallback.
- `not_found`: HTTP 404; `nopol` + `vehicle`.
- `ambiguous`: HTTP 409; safe method only, no candidates/values.
- `conflict`: HTTP 409; method + conflicting field names.
- `invalid_nopol`: HTTP 400 error envelope + request ID.
- `unsupported_query_parameter`: HTTP 400 error envelope + request ID.
- `rate_limit_exceeded`: HTTP 429 + `Retry-After`.
- `upstream_error`: HTTP 502/504, NOPOL + sanitized public error.
- `database_error`: HTTP 503 sanitized error.
- `matching_error`/`internal_error`: HTTP 500 sanitized error.

## 4. OpenAPI

- Location: `docs/openapi.json`
- Version: OpenAPI 3.1.0
- API contract version: 1.0.0
- Coverage: `/api/njkb/{nopol}`, `/health`, `/ready`
- Response statuses: 200, 400, 404, 409, 429, 500, 502, 503, 504
- Schemas: matched, reference unavailable, not found, ambiguous, conflict, invalid
  request, rate limit, upstream/internal/readiness errors, operational responses
- Examples: verified 2024, 2025, dan 2026 plus invalid/not-found/conflict/query errors
- Redocly validation: 0 errors, 3 non-contractual warnings

Warnings retained intentionally:

1. license field absent because project license has not been specified;
2. `/health` and `/ready` do not invent 4xx responses absent from implementation.

## 5. Documentation

- `docs/api.md` — authoritative consumer-facing contract
- `docs/openapi.json` — machine-readable OpenAPI 3.1
- `docs/integration-guide.md` — curl/JS/PHP integration and error handling
- `docs/api-change-policy.md` — compatibility, versioning, deprecation policy
- `docs/production-operations.md` — operational runbook
- `README.md` — links to contract documentation

## 6. Contract Tests

Phase 9 adds 14 tests in `tests/contract.test.ts`:

- exact matched response shapes for 2024/2025/2026;
- decimal-string NJKB/weight contract;
- lowercase/whitespace/hyphen normalization;
- not found, ambiguous, conflict, reference unavailable;
- invalid/query/upstream/database/matching/rate-limit errors;
- server-generated request ID and security headers;
- OpenAPI route/status/schema/no-internal-field checks;
- PII/internal metadata exclusion.

Final isolated repository suite:

```text
8 test files
130 tests
130 PASS
```

Vitest is now explicitly limited to `tests/**/*.test.ts`; `.kilo/worktrees` no longer
contaminates root test counts.

## 7. Backward Compatibility

Protected by tests:

- endpoint and GET method;
- top-level/nested matched keys;
- public method names;
- status/error code mapping;
- decimal string monetary and six-decimal weight representation;
- conditional absence of NJKB/source/internal candidates;
- request ID and security headers;
- no CORS;
- no PII/internal identifiers;
- exact-year regulatory semantics and no fallback.

No breaking change introduced.

## 8. Production Verification

| Test | Expected | Actual | Status |
|---|---|---|---|
| `/health` | 200 ok | 200 ok | PASS |
| `/ready` | 200 ready | 200 ready | PASS |
| 2024 `DH4786PD` | Pergub / 12.500.000 | Pergub / 12.500.000 | PASS |
| 2025 `DH4874PF` | Pergub / 16.600.000 | Pergub / 16.600.000 | PASS |
| 2026 `DH2630PI` | Permendagri / 16.900.000 | Permendagri / 16.900.000 | PASS |
| invalid | 400 invalid_nopol | 400 invalid_nopol | PASS |
| not found `DH2582PI` | 404 not_found | 404 not_found | PASS |
| conflict `DH2212ET` | 409 conflict | 409 conflict | PASS |
| unsupported query | 400 unsupported_query_parameter | 400 | PASS |

OpenAPI examples correspond to actual production snapshots.

## 9. Security / PII

- PII leakage: 0
- Secrets in new docs/OpenAPI/tests: 0
- Internal D1/reference/document/audit identifiers exposed: 0
- Raw BPAD payload included: 0
- Security headers: documented and tested
- CORS disabled: documented and tested
- Request ID: server-generated UUID; client value not trusted

## 10. Changes Made

### Runtime code

**NO RUNTIME BEHAVIOR CHANGE**

### Test changes

- Added `tests/contract.test.ts` (14 tests).
- Updated `vitest.config.ts` to include only root repository tests.

### Documentation changes

- Replaced stale `docs/api.md` with actual production contract.
- Added `docs/openapi.json`.
- Added `docs/integration-guide.md`.
- Added `docs/api-change-policy.md`.
- Updated README links.

### Configuration changes

- Test-only Vitest include scope; no Worker/Wrangler production config change.

No production Worker deployment was performed.

## 11. Remaining Action Items

| Priority | Action | Blocking? |
|---|---|---|
| MEDIUM | Host rendered OpenAPI/API explorer if consumer demand exists | No |
| MEDIUM | Add isolated root test/contract checks to CI | No |
| LOW | Publish generated TypeScript/PHP SDK only if consumer demand justifies maintenance | No |
| LOW | Define project license and add OpenAPI license metadata | No |
| LOW | Evaluate authentication only if API access policy changes | No |

## 12. Final Classification

**API INTEGRATION READY WITH ACTION ITEMS**

Core contract stable, documented, machine-readable, production-verified, dan protected
by contract/backward compatibility tests. Remaining items are distribution/automation,
bukan contract defects.

## 13. Phase Decision

- Phase 9 dapat ditutup: **YA**.
- Public API siap digunakan consumer lain: **YA**, terutama server-to-server karena CORS disabled.
- Breaking change: **TIDAK ADA**.
- Remediation diperlukan: **TIDAK**.
- Fase berikutnya dapat dimulai: **YA**.
