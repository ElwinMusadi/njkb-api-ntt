# Private Unified Vehicle API

Status: **Active in production with Cloudflare Access Service Auth; Canary verified**.

Target endpoint:

```text
GET /api/v1/vehicle/{nopol}
```

Host: `https://api.uptdpenda-kupang.web.id`

Route registration is active in production Worker version `69cb7cf7-db68-42e2-92f9-e26aef880462` protected by Cloudflare Access. The endpoint is accessible only via valid Cloudflare Access Service Token credentials and approved grant mapping.

Existing public endpoint `GET /api/njkb/{nopol}` remains unchanged.

## Production authentication

Consumers authenticate to Cloudflare Access at the edge using Service Token headers:

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

Active production values:
- `AUTH_ISSUER`: `https://shy-thunder-ffc9.cloudflareaccess.com`
- `AUTH_AUDIENCE`: `927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa`
- `AUTH_JWKS_URL`: `https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs`
- `AUTH_CLOCK_TOLERANCE_SECONDS`: `30`
- `AUTH_ACCESS_GRANTS_JSON`: Registered for `njkb-api-canary` (`vehicle:read`, `njkb:read`) and `kalkulator-pajak-kendaraan` (`vehicle:read`, `registration:read`, `owner:read`, `tax:read`, `njkb:read`).
- Rate limit: 60 requests / 60 seconds / principal / isolate.

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

## Safety and governance

- `Cache-Control: no-store` and current security headers;
- CORS disabled;
- no raw/PII/JWT/service-secret logging;
- no BPAD PII persistence;
- current NJKB matcher remains authoritative;
- Canary consumer `njkb-api-canary` verified end-to-end;
- Future consumer onboarding governed by `docs/security/private-api-consumer-onboarding.md`;
- Operational governance and drift verification: `docs/security/private-api-operations.md`;
- Security monitoring and audit event model: `docs/security/private-api-monitoring.md`.

Provider decision/lifecycle: `docs/security/private-api-provider-decision.md`.
Machine-readable contract: `docs/openapi-private.json`.
