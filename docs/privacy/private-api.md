# Private API Technical Privacy Foundation

Status: technical privacy policy foundation; not legal advice and not active endpoint policy.

## Data classes

- Non-sensitive vehicle: brand, type, category, year, fuel, color, cylinder capacity.
- Registration/administrative: usage, dealer/origin codes, STNK dates, UPT, opaque codes.
- Personal data: owner name/address, geographic components, ownership/business data,
  NOPOL.
- Highly sensitive identifiers: identity number, BPKB, chassis, engine, previous NOPOL,
  business license/number, Kohir.
- Unknown semantics: KD_DUMP, KD_JR, KE, K_JR, Skum until BPAD documentation exists.

Complete per-field policy: `src/bpad/field-policy.ts`.

## Exposure rules

- Existing public API: no BPAD PII/raw.
- Private endpoint: sections omitted without explicit scope.
- Raw payload requires `bpad:raw`.
- Sensitive vehicle identifiers require `registration:read`.
- Phone is not established and must not be emitted.
- Unknown future raw fields inherit private raw-scope treatment and trigger review.

## Storage

BPAD is live source. Raw and normalized BPAD owner/tax/registration data are not stored
in D1 by this architecture. Canonical NJKB reference remains separate.

## Logging and errors

Raw BPAD and PII never appear in logs or error bodies. Errors contain only safe status,
code, message, and request ID. Do not store response examples from production.

## Caching

Private responses use `Cache-Control: no-store`. No shared edge/application cache. Any
future private cache requires explicit encryption, tenant/principal partitioning,
retention, deletion, and incident policy.

## Synthetic fixtures

Tests use only clearly synthetic owner/address/identity/chassis/engine/BPKB values.
Production BPAD response values must never be copied into repository fixtures or docs.

## Activation prerequisites

- approved access-control architecture;
- authorized consumer list and scopes;
- retention/deletion policy;
- access audit retention;
- incident/revocation runbook;
- schema drift review policy;
- security and privacy review.
