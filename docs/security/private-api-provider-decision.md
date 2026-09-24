# Private API Identity Provider Decision

Status: **SELECTED / PRE-DEPLOYMENT SECURITY GATE READY**

Decision date: 24 September 2026.
Official sources reviewed:

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

## Requirements

- service-to-service identity;
- RS256 verification at Worker;
- exact issuer/audience;
- trusted HTTPS JWKS;
- stable non-secret principal;
- project-owned six-scope authorization;
- rotation/revocation;
- no raw JWT/service secret/PII logs;
- fail closed before BPAD/D1.

## Selected Provider — Cloudflare Access

Cloudflare Access is the selected identity boundary. Consumers use Access Service Tokens
with `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Access applies a Service Auth
policy and injects `Cf-Access-Jwt-Assertion` toward the Worker. The Worker independently
verifies that assertion using the Access account JWKS.

Selected facts from official documentation:

- issuer: `https://<team-name>.cloudflareaccess.com`;
- JWKS: `<issuer>/cdn-cgi/access/certs`;
- algorithm: RS256;
- audience: unique Access Application AUD tag;
- key rotation: default approximately six weeks;
- previous key remains valid approximately seven days;
- service-token JWT can have empty `sub` and stable `common_name` equal to service-token
  client identity;
- service-token secret supports rotation grace period, refresh, disable, and delete.

Provisioned values verified for readiness:

- team domain: `shy-thunder-ffc9.cloudflareaccess.com`;
- issuer: `https://shy-thunder-ffc9.cloudflareaccess.com`;
- JWKS: `https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs`;
- AUD: `927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa`;
- application/policy: `API Kendaraan BPAD NTT` / `NJKB API - Canary Service Auth`;
- canary token name/client ID: `njkb-api-canary` / `d6bb9db60e9cd5ee91327eed387cf2fb.access`.

Client Secret remains external and is not a Worker configuration value.

## Candidate B — Organization OIDC/JWT

Not selected. No organization issuer, JWKS, audience, client registration, scope claim,
key owner, or lifecycle evidence exists. It remains technically compatible with generic
verifier contracts but is not the project production provider.

## Principal Mapping

Verified Access assertion:

```text
common_name (service-token client identity)
→ AUTH_ACCESS_GRANTS_JSON exact lookup
→ stable project principal label
```

The Worker does not use empty service-token `sub`, email, or arbitrary request headers.
Unknown `common_name` fails authentication. Grant principals/common names must be unique.
Principal labels are non-secret and restricted to `[A-Za-z0-9._:-]`.

## Scope Mapping

Cloudflare Access authenticates service identity. It does not provide trusted project
scopes by default. Project scopes come only from reviewed Worker configuration:

```json
[
  {
    "access_common_name": "<actual Access service-token client identity>",
    "principal": "<approved service principal>",
    "scopes": ["vehicle:read", "njkb:read"]
  }
]
```

Configuration name:

```text
AUTH_ACCESS_GRANTS_JSON
```

Every grant requires `vehicle:read` or `vehicle:full`. Unknown/duplicate principal,
unknown scope, or malformed configuration fails closed. Client JWT/custom/request claims
cannot self-assign scopes.

`vehicle:full` remains exactly:

```text
vehicle:read registration:read tax:read owner:read njkb:read bpad:raw
```

## Token Lifecycle

Access application session duration: **24 hours** (operator configuration).

Worker requires `exp`, validates optional `nbf`, and uses approved clock tolerance:
**30 seconds**.
Worker does not implement refresh tokens or stateful sessions.

Service-token duration, inactivity cleanup, and expiration alert: **REQUIRES PRODUCTION
DECISION**.

## Key Rotation

Cloudflare owns Access signing keys and publishes current/previous JWKs. Existing Worker
resolver handles kid selection, cache, previous keys, same-kid refresh, unknown kid, and
provider outage. Security Administrator owns Access application/key-rotation operations.
Actual role assignment is not established.

## Credential Lifecycle

### Onboarding

1. Consumer Owner requests scopes.
2. Authorization Approver approves exact grant.
3. Access Administrator creates service token and application policy.
4. Secret is delivered through approved secret manager, once.
5. API Owner adds exact common_name/principal/scopes configuration through reviewed deploy.
6. Security tests/canary run before activation.

### Rotation

1. Access Administrator rotates service-token secret with approved grace period.
2. Consumer Owner updates secret securely.
3. Validate canary.
4. Revoke old secret after grace period.

### Revocation/offboarding

1. Disable/delete service token at Access.
2. Remove principal grant through reviewed configuration deployment.
3. Verify requests fail.
4. Record lifecycle event.

### Emergency

- leaked consumer secret: disable/delete token immediately;
- signing key incident: Access emergency rotation; Worker JWKS refresh;
- unauthorized scope: remove grant/deploy, revoke token, review logs;
- compromised consumer: revoke credential and grant.

## Operational Ownership

Actual teams/persons are not established. Required roles:

| Responsibility | Required role | Assignment |
|---|---|---|
| Identity provider / Access org | Security Administrator | NOT ESTABLISHED |
| Access application/policy | Access Administrator | NOT ESTABLISHED |
| Signing-key incident | Security Administrator | NOT ESTABLISHED |
| API configuration/deployment | API Owner | NOT ESTABLISHED |
| Consumer onboarding | Consumer Owner + Authorization Approver | NOT ESTABLISHED |
| Scope authorization | Authorization Approver | NOT ESTABLISHED |
| Rotation/revocation | Access Administrator + Consumer Owner | NOT ESTABLISHED |
| Monitoring | Security Operations | NOT ESTABLISHED |
| Incident response | Incident Commander/Security Operations | NOT ESTABLISHED |

## Audit Requirements

Persistent audit is design-only. Required safe fields:

- timestamp;
- request ID;
- approved principal label/pseudonym;
- sanitized route/method;
- auth/authz/rate-limit result;
- requested scope category;
- HTTP status/latency/error category.

Never log Access client secret, assertion JWT, Authorization, BPAD raw, owner PII, or
vehicle sensitive identifiers.

## Remaining Governance / Deployment Prerequisites

- actual signed canary assertion verification is deferred to controlled deployment;
- persistent audit destination/retention/alerts;
- actual role assignments;
- explicit deployment approval/rollback owner.

Approved initial grant: canary common_name → `njkb-api-canary` →
`vehicle:read,njkb:read`. Approved application safeguard: 60 requests/60 seconds per
principal per isolate.

## Security Consequences

Access is authentication/edge policy only. NJKB API authorization remains mandatory.
`Cf-Access-Jwt-Assertion` is never trusted without Worker signature/issuer/audience/time
verification. `CF-Access-Client-*` headers are not used by application logic and never
logged.

## Next Phase

Proceed to controlled production auth wiring and canary only after review/commit of the
prepared non-secret Worker configuration and approval of monitoring/ownership/rollback.
No production activation occurs in this phase.
