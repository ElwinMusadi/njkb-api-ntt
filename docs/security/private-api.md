# Private API Security and Access Lifecycle

Status: **Active in production with Cloudflare Access Service-to-Service authentication; Canary verified**.

## Trust boundary

```text
Consumer service
  → CF-Access-Client-Id / CF-Access-Client-Secret
  → Cloudflare Access Service Auth policy
  → Cf-Access-Jwt-Assertion
  → Worker RS256/issuer/audience/time verification
  → common_name grant lookup
  → project scopes
  → scope-aware response
```

Client credentials terminate at Cloudflare Access. Application logic never consumes or
logs Client ID/Secret. `Authorization: Bearer` generic verification remains reusable but
is not the selected Access route input.

## Production configuration contract

Active production Worker configuration:

```text
AUTH_ISSUER=https://shy-thunder-ffc9.cloudflareaccess.com
AUTH_AUDIENCE=927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa
AUTH_JWKS_URL=https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs
AUTH_CLOCK_TOLERANCE_SECONDS=30
AUTH_ACCESS_GRANTS_JSON=[{"access_common_name":"d6bb9db60e9cd5ee91327eed387cf2fb.access","principal":"njkb-api-canary","scopes":["vehicle:read","njkb:read"]},{"access_common_name":"258c62aadaa1dad3ca33f871d8439a88.access","principal":"kalkulator-pajak-kendaraan","scopes":["vehicle:read","registration:read","owner:read","tax:read","njkb:read"]}]
```

Grant JSON is authorization policy, not client-controlled input. The Client Secret is
consumer-side and never a Worker variable.

Consumer secret storage:

- generated/displayed by Cloudflare Access;
- stored in consumer secret manager;
- never stored in Worker, Git, docs, logs, or response.

## Principal and scopes

Access service JWT `common_name` maps through `AUTH_ACCESS_GRANTS_JSON` to a stable project
principal. Empty `sub` is not weakened or copied. Unknown common_name is unauthorized.

Project scopes remain:

```text
vehicle:read registration:read tax:read owner:read njkb:read bpad:raw vehicle:full
```

`vehicle:full` is exact six-scope bundle. Every configured consumer requires
`vehicle:read` or `vehicle:full` to access the endpoint.

## Fail closed

- No injected authenticator → private route absent/404.
- Missing/malformed assertion → 401.
- Invalid signature/issuer/audience/time/common_name → 401.
- JWKS/provider unavailable → 503.
- Insufficient project scope → 403.
- No fallback bearer/client header/anonymous identity.
- Authentication and authorization precede rate limiter, BPAD, and D1.

## Lifecycle

### Onboarding

Consumer identification → scope approval → Access service token/policy → secure secret
delivery → exact grant config → canary → activation.

### Rotation

Access secret rotation with explicit grace period → consumer update → canary → old secret
revocation.

### Revoke/offboard

Disable/delete Access token → remove grant config → deploy → verify 401/Access rejection →
record event.

### Incident

Revoke compromised token, remove grants, rotate Access keys when applicable, inspect safe
logs, validate no PII/raw/token exposure.

## Audit and monitoring

Current structured request log is implemented but persistent security audit is not.
Before production canary configure destination/retention/alerts for authentication,
authorization, JWKS, rate-limit, and upstream failures. Log principal label only if
approved; never assertion JWT, Client Secret, NOPOL, or PII/raw payload.

## Rate limiting

Approved initial policy: 60 requests per 60 seconds per stable project principal per
Worker isolate. Limiter runs after authentication/base authorization and before BPAD.
It is a bounded application safeguard, not a global distributed quota or WAF rule.

## Production operational governance

- Active Worker version: `69cb7cf7-db68-42e2-92f9-e26aef880462` on `api.uptdpenda-kupang.web.id`;
- Rollback target checkpoint: `45f16da5-a1d7-46ef-9f1a-8d21679fde7e`;
- Canary principal: `njkb-api-canary` (system test / smoke verification only);
- Production consumer principal: `kalkulator-pajak-kendaraan` (Kalkulator Pajak Kendaraan);
- Consumer onboarding runbook: `docs/security/private-api-consumer-onboarding.md`;
- Monitoring, observability, and audit event model: `docs/security/private-api-monitoring.md`;
- Drift verification and operational governance: `docs/security/private-api-operations.md`.
