# Public API Contract — NJKB API NTT

## 1. Tujuan dan Base URL

API mengembalikan NJKB regulatory berdasarkan identitas kendaraan yang diperoleh dari
BPAD NTT. API tidak mengembalikan data pemilik.

```text
Production: https://njkb-api-ntt.elwinmusadi.workers.dev
```

OpenAPI 3.1: [`docs/openapi.json`](openapi.json).

Authentication: tidak ada application authentication pada versi saat ini.

## 2. Endpoint

```http
GET /api/njkb/{nopol}
```

Tidak ada public query parameter. Request seperti berikut selalu ditolak:

```http
GET /api/njkb/DH4874PF?tax_year=2025
```

Response: HTTP 400 `unsupported_query_parameter`.

`tax_year`, `edition`, `regulation`, `source`, dan `resolution_as_of` bukan public lookup
parameter. Vehicle year diperoleh dari BPAD.

## 3. NOPOL Semantics

Server menerapkan:

1. Unicode NFKC normalization;
2. uppercase;
3. menghapus whitespace dan hyphen;
4. memvalidasi hasil terhadap `^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$`.

Contoh yang ekuivalen:

```text
DH4786PD
dh4786pd
dh 4786 pd
DH-4786-PD
```

Character lain, empty value, dan format di luar pola ditolak HTTP 400. Path parameter
harus di-URL-encode sesuai standard client HTTP jika mengandung whitespace.

## 4. Regulatory Semantics

- Vehicle year ≤ 2025 menggunakan Pergub NTT No. 26 Tahun 2025.
- Vehicle year = 2026 menggunakan Permendagri No. 11 Tahun 2026.
- Vehicle year ≥ 2027 menghasilkan `reference_unavailable` sampai approved reference
  tersedia.
- Lookup selalu exact vehicle year; tidak ada adjacent/cross-year fallback.
- API tidak membuat code alias atau mapping otomatis.
- Fuzzy candidate tidak pernah menjadi NJKB public match.

## 5. Matched Response

HTTP 200, `Content-Type: application/json`.

```json
{
  "status": "matched",
  "nopol": "DH4874PF",
  "vehicle": {
    "brand": "HONDA",
    "type": "F1C02N46L2 A/T",
    "year": 2025
  },
  "njkb": {
    "value": "16600000.00",
    "weight": "1.000000",
    "dpp_pkb": "16600000.00"
  },
  "match": {
    "method": "exact_code_year_and_brand_type",
    "source_code": "701167 17549"
  },
  "source": {
    "regulation": "Pergub NTT No. 26 Tahun 2025",
    "pdf_page": 508,
    "source_row": "5880"
  }
}
```

Contract notes:

- `njkb.value` dan `njkb.dpp_pkb` adalah decimal **string** Rupiah dengan dua digit
  pecahan, bukan JSON number.
- `njkb.weight` adalah decimal **string** fixed-point enam digit.
- Ketiga field NJKB nullable jika source row memang tidak memiliki nilai terkait.
- `edition_id`, internal reference ID, document hash, dan audit ID tidak diekspos.
- Public methods saat ini: `exact_code_year_and_brand_type`,
  `exact_brand_type_year_and_category`, dan `verified_code_mapping`.

## 6. Status dan Error Contract

| Scenario | HTTP | Public status/error | Description |
|---|---:|---|---|
| Matched | 200 | `matched` | NJKB ditemukan pada approved exact-year reference |
| Reference unavailable | 200 | `reference_unavailable` | Approved source tidak mencakup exact year/category |
| Invalid NOPOL | 400 | `invalid_request` / `invalid_nopol` | Format NOPOL invalid |
| Unsupported query | 400 | `invalid_request` / `unsupported_query_parameter` | Semua query parameter tidak didukung |
| Not found | 404 | `not_found` | Approved coverage ada, identity tidak ditemukan |
| Route not found | 404 | `error` / `route_not_found` | Route tidak tersedia |
| Ambiguous | 409 | `ambiguous` | Lebih dari satu exact/verified candidate |
| Conflict | 409 | `conflict` | Exact code candidate bertentangan dengan identity BPAD |
| Rate limit | 429 | `invalid_request` / `rate_limit_exceeded` | Per-isolate fixed window terlampaui |
| Internal/matching | 500 | `error` / `matching_error` atau `internal_error` | Internal failure disanitasi |
| BPAD failure | 502 | `upstream_error` | Network, HTTP, malformed JSON, atau invalid payload |
| Database unavailable | 503 | `error` / `database_error` | D1 operation gagal |
| BPAD timeout | 504 | `upstream_error` / `timeout` | Total BPAD operation melewati timeout |

### Invalid request

```json
{
  "status": "invalid_request",
  "error": {
    "code": "invalid_nopol",
    "message": "Format NOPOL tidak valid",
    "request_id": "00000000-0000-4000-8000-000000000000"
  }
}
```

### Not found

```json
{
  "status": "not_found",
  "nopol": "DH2582PI",
  "vehicle": {
    "brand": "HONDA",
    "type": "L1F02N36L2 A/T",
    "year": 2026
  }
}
```

### Conflict

```json
{
  "status": "conflict",
  "nopol": "DH2212ET",
  "vehicle": {
    "brand": "VESPA",
    "type": "SPRINT S 180",
    "year": 2026
  },
  "match": {
    "method": "exact_code_year_and_brand_type",
    "conflicts": ["type"]
  }
}
```

### Reference unavailable

HTTP 200:

```json
{
  "status": "reference_unavailable",
  "nopol": "DH0000XX",
  "vehicle": {
    "brand": "EXAMPLE",
    "type": "EXAMPLE",
    "year": 2027
  }
}
```

`DH0000XX` hanya ilustrasi schema, bukan fixture production. Scenario ini dibuktikan
melalui contract/unit tests; tidak ada synthetic vehicle yang dimasukkan ke production.

### Upstream error

```json
{
  "status": "upstream_error",
  "nopol": "DH4786PD",
  "error": {
    "code": "timeout",
    "message": "Layanan kendaraan BPAD melewati batas waktu",
    "request_id": "00000000-0000-4000-8000-000000000000"
  }
}
```

Supported upstream codes: `timeout`, `network_error`, `http_error`, `malformed_json`,
`invalid_payload`.

## 7. Intended Response Headers

Semua response, termasuk error:

- `Content-Type: application/json`
- `Cache-Control: no-store`
- `X-Request-ID: <server-generated UUID>`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

CORS disabled: `Access-Control-Allow-Origin` tidak dikirim. Browser frontend dari origin
lain tidak dapat memakai API secara langsung tanpa perubahan contract CORS yang disetujui.

Client tidak dapat memasukkan request ID. Worker selalu membuat UUID baru dan memakai
nilai yang sama pada header, public error body, dan structured logs. Match audit tidak
menyimpan request ID.

## 8. Rate Limiting

Application safeguard: 60 request/60 detik per client key per Worker isolate. HTTP 429
memuat `rate_limit_exceeded` dan `Retry-After`.

Ini bukan global exact rate limit. Cloudflare WAF global rate rule belum dikonfigurasi.
Consumer tidak boleh bergantung pada tepat request ke-61 selalu menghasilkan 429.

## 9. PII dan Caching

Public response hanya memuat brand, type, dan year kendaraan. Owner, telepon, alamat,
NIK, chassis, engine, BPKB, raw BPAD payload, dan internal D1 identifiers tidak diekspos.

Semua response memakai `Cache-Control: no-store`.

## 10. Operational Endpoints

```http
GET /health
```

Liveness; tidak memanggil BPAD atau D1. HTTP 200 `{ "status": "ok" }`.

```http
GET /ready
```

Menjalankan query D1 ringan. HTTP 200 `{ "status": "ready" }` atau HTTP 503 sanitized
`database_unavailable`.

Operational endpoints tidak terkena application lookup rate limiter.

## 11. Known Limitations

- BPAD adalah external dependency; network/payload availability dapat menghasilkan
  502/504.
- Global WAF rate limiting belum dikonfigurasi.
- API belum memiliki application authentication.
- Hanya NTT/provincial scope dan approved national 2026 reference yang tersedia.
- Tidak ada SDK resmi atau hosted interactive API explorer saat ini.
