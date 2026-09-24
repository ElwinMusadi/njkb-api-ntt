# Private Unified Vehicle API

Status: implemented for local/integration testing; Cloudflare Access selected;
production Access resources/configuration unavailable; not deployed.

Target endpoint:

```text
GET /api/v1/vehicle/{nopol}
```

Route registration is conditional on injecting a `RequestAuthenticator` into
`createApp()`. Default production construction has no authenticator, so the route remains
404 until Access resources, verified configuration, grants, and monitoring are supplied.

Existing `GET /api/njkb/{nopol}` remains unchanged.

## Production authentication target

Consumers authenticate to Cloudflare Access using Service Token headers:

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

Access enforces its Service Auth policy and injects:

```text
Cf-Access-Jwt-Assertion
```

The Worker independently validates assertion signature, exact issuer/audience, exp/nbf,
and configured common_name grant. Client credentials never reach business logic.

Exact issuer, audience, JWKS URL, canary grant, 30-second clock tolerance, and 60/60
per-principal/isolate safeguard are approved and prepared for the next deployment phase.
They are not yet configured on the production Worker.

## Execution order

```text
request ID/security headers
→ Access JWT authentication
→ vehicle:read authorization
→ principal rate limit
→ reject query parameters
→ BPAD full-record adapter
→ unified composition + existing matcher
→ scope-aware shaper
→ no-store private JSON response
```

Missing/invalid authentication and insufficient scope execute zero BPAD calls and zero
D1 matching/audit operations.

## Scope contract

| Section | Scope |
|---|---|
| basic `vehicle`, BPAD metadata | `vehicle:read` |
| `registration`, `administrative`, NoBPKB/NoRangka/NoMesin | `registration:read` |
| `tax` | `tax:read` |
| `owner` | `owner:read` |
| `njkb`, `match`, `source` | `njkb:read` |
| `bpad.raw` | `bpad:raw` |
| all approved sections | `vehicle:full` exact bundle |

Authentication grants no scope implicitly. Access default claims are never interpreted as
project scopes. Scopes come only from the reviewed common_name grant registry.

## Response/status contract

BPAD success returns HTTP 200 `vehicle_found` with independent `njkb_status`: matched,
not_found, reference_unavailable, conflict, or ambiguous. BPAD errors use 502/504; auth
uses 401/403; provider outage uses 503; rate limit uses 429.

Raw values are returned only with `bpad:raw`; normalized sections do not mutate raw.
Phone is not established and absent.

## Safety and activation

- no-store and current security headers;
- CORS disabled;
- no raw/PII/JWT/service-secret logging;
- no BPAD PII persistence;
- current NJKB matcher remains authoritative;
- production route not active/deployed;
- production Access Application/service tokens not created in repository workflow.

Provider decision/lifecycle: `docs/security/private-api-provider-decision.md`.
Machine-readable contract: `docs/openapi-private.json`.
