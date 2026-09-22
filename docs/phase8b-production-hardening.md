# Phase 8B — Production Hardening

Tanggal: 22 September 2026.

## Status

Phase 8B mengeraskan Worker tanpa mengubah regulatory boundary, matching hierarchy,
response sukses, canonical dataset, migration, atau konfigurasi production deployment.

## Health

`GET /health` adalah liveness endpoint. Response deterministik:

```json
{"status":"ok"}
```

Endpoint tidak memanggil BPAD dan tidak melakukan query D1.

## Readiness

`GET /ready` menjalankan satu query ringan:

```sql
SELECT 1 AS ready
```

- D1 tersedia: HTTP 200 `{ "status": "ready" }`
- D1 gagal: HTTP 503 dengan `database_unavailable`

Error mentah D1, SQL, stack trace, binding, dan environment tidak diekspos.

## Security headers

Middleware global menerapkan header berikut pada response sukses dan error:

- `Cache-Control: no-store`
- `X-Request-ID`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

CORS tetap tidak diaktifkan. CSP minimal sesuai service JSON API tanpa aset HTML.

## BPAD retry policy

Adapter mempertahankan total timeout budget 5.000 ms. Retry policy:

- maksimum dua fetch attempt, berarti tepat satu retry;
- hanya network/fetch exception non-timeout yang di-retry;
- delay default 300 ms;
- timeout menggunakan satu `AbortController` untuk seluruh operation, bukan timeout baru per attempt;
- HTTP response apa pun tidak di-retry;
- malformed JSON dan invalid payload tidak di-retry.

Worst-case tetap sekitar 5 detik termasuk delay retry, bukan 10,3 detik.

## Rate limiting

`FixedWindowRateLimiter` melindungi `/api/njkb/:nopol` dengan konfigurasi default:

- 60 request per 60 detik per key;
- key production: trusted Cloudflare `CF-Connecting-IP`;
- fallback local/test: `local:unknown`;
- maksimum 10.000 client entry per isolate;
- expired entry dibersihkan dan entry tertua dieviction saat kapasitas tercapai;
- tidak menggunakan D1 dan tidak menulis match audit ketika request ditolak;
- rejection: HTTP 429 `rate_limit_exceeded` dan `Retry-After` berdasarkan reset window.

Limitation: limiter bersifat per Worker isolate, bukan globally distributed exact rate
limit. Cloudflare WAF Rate Limiting tetap diperlukan sebagai kontrol global pada Phase
8C/8D. Arbitrary `X-Forwarded-For` tidak digunakan.

Health dan readiness tidak terkena limiter agar probe operasional tidak menghabiskan
quota API lookup.

## Structured logging

Log request sekarang berformat JSON dan memuat:

- `event`
- `request_id`
- `method`
- sanitized `path`
- result category
- HTTP status
- duration

Path lookup dicatat sebagai `/api/njkb/:nopol`, bukan NOPOL aktual. Raw BPAD payload,
NOPOL, owner PII, header authorization, cookie, dan secret tidak dicatat.

## Error contract

Contract existing dipertahankan. Phase 8B menambah HTTP 429:

```json
{
  "status": "invalid_request",
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Terlalu banyak permintaan",
    "request_id": "..."
  }
}
```

Response tidak mengandung limiter state internal, stack trace, atau database detail.

## Test coverage

Test baru mencakup:

- liveness tanpa BPAD/D1;
- readiness D1 success dan failure;
- security headers pada response sukses dan client error;
- rate limit below threshold, per-IP isolation, HTTP 429, expiry, bounded memory;
- HTTP 429 tidak memanggil BPAD atau menulis match audit;
- retry network failure lalu success;
- dua network failure berhenti pada attempt kedua;
- HTTP error, timeout, malformed JSON, dan invalid payload tidak di-retry;
- structured logging memakai sanitized path tanpa NOPOL.

## Data integrity

Phase 8B tidak mengubah dataset atau migration:

- Pergub NTT 26/2025: 62.091 active reference
- Permendagri 11/2026: 2.783 active reference
- Total: 64.874
- Vehicle mappings: 0

Canonical hash tetap:

- Pergub: `c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c`
- Permendagri: `fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e`

## Batas scope

Phase 8B tidak:

- membuat production D1;
- mengubah `wrangler.jsonc` production binding atau route;
- membuat export SQL pipeline;
- melakukan deployment;
- memulai Phase 8C, 8D, atau 8E.
