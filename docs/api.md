# Public API contract

## Route

```http
GET /api/njkb/{nopol}
```

The route has no public lookup query parameters. `vehicle_year` comes from the normalized BPAD response. A request such as `?tax_year=2026` is rejected with `400 unsupported_query_parameter`.

Only `brand`, `type`, and `year` are returned for the vehicle. Owner, address, identity, chassis, engine, and contact data are neither persisted nor exposed.

## Status mapping

| HTTP | `status` | Meaning |
|---:|---|---|
| 200 | `matched` | Exact/verified reference from an approved edition |
| 200 | `reference_unavailable` | No approved source covers the exact vehicle year/category |
| 404 | `not_found` | Approved coverage exists, but the identity is absent |
| 409 | `ambiguous` | More than one exact/verified candidate |
| 409 | `conflict` | Code candidate contradicts the vehicle identity |
| 400 | `invalid_request` | Invalid NOPOL or unsupported query parameter |
| 502/504 | `upstream_error` | BPAD HTTP/payload/network error or timeout |
| 503 | `error` / `database_error` | D1 lookup failed |
| 500 | `error` / `matching_error` | Unexpected matching failure |

## Matched example

```json
{
  "status": "matched",
  "nopol": "DH2026ZZ",
  "vehicle": {
    "brand": "HONDA",
    "type": "C1M02N42L1 A/T",
    "year": 2026
  },
  "njkb": {
    "value": "12900000.00",
    "weight": "1.000000",
    "dpp_pkb": "12900000.00"
  },
  "match": {
    "method": "exact_code_year_and_brand_type",
    "source_code": "701167 67749"
  },
  "source": {
    "regulation": "Permendagri No. 11 Tahun 2026",
    "pdf_page": 55,
    "source_row": "311"
  }
}
```

## Reference unavailable example

```json
{
  "status": "reference_unavailable",
  "nopol": "DH4786PD",
  "vehicle": {
    "brand": "HONDA",
    "type": "C1M02N42L1 A/T",
    "year": 2024
  }
}
```

Responses use `Cache-Control: no-store`. Logs contain request ID, status, HTTP status, duration, and error class only; they exclude NOPOL and BPAD vehicle fields.
