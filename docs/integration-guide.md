# Integration Guide — NJKB API NTT

## 1. Base URL dan Endpoint

```text
https://njkb-api-ntt.elwinmusadi.workers.dev
GET /api/njkb/{nopol}
```

Tidak ada authentication atau public query parameter saat ini. Jangan mengirim
`tax_year`, edition, atau resolution date.

## 2. cURL

```sh
curl --fail-with-body \
  --max-time 8 \
  -H "Accept: application/json" \
  "https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/DH4874PF"
```

## 3. JavaScript / TypeScript

```ts
interface MatchedNjkb {
  status: 'matched';
  nopol: string;
  vehicle: { brand: string; type: string; year: number };
  njkb: { value: string | null; weight: string | null; dpp_pkb: string | null };
  match: { method: string; source_code: string };
  source: { regulation: string; pdf_page: number; source_row: string };
}

async function lookupNjkb(nopol: string, signal?: AbortSignal): Promise<MatchedNjkb> {
  const response = await fetch(
    `https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/${encodeURIComponent(nopol)}`,
    { headers: { Accept: 'application/json' }, signal }
  );
  const body = await response.json();
  if (!response.ok || body.status !== 'matched') {
    throw Object.assign(new Error(`NJKB lookup failed: ${body.status}`), {
      httpStatus: response.status,
      body,
      requestId: response.headers.get('x-request-id')
    });
  }
  return body as MatchedNjkb;
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8_000);
try {
  const result = await lookupNjkb('DH4874PF', controller.signal);
  console.log(result.njkb.value); // decimal string; do not parse with floating point
} finally {
  clearTimeout(timer);
}
```

## 4. PHP / Laravel

```php
use Illuminate\Support\Facades\Http;

$response = Http::acceptJson()
    ->timeout(8)
    ->connectTimeout(3)
    ->get('https://njkb-api-ntt.elwinmusadi.workers.dev/api/njkb/' . rawurlencode($nopol));

$requestId = $response->header('X-Request-ID');
$body = $response->json();

if ($response->successful() && ($body['status'] ?? null) === 'matched') {
    // NJKB adalah decimal string Rupiah.
    $njkb = $body['njkb']['value'];
} else {
    logger()->warning('NJKB lookup failed', [
        'request_id' => $requestId,
        'http_status' => $response->status(),
        'status' => $body['status'] ?? 'invalid_json',
        'error_code' => data_get($body, 'error.code'),
    ]);
}
```

Jangan gunakan `Http::retry()` tanpa batas. Jika diperlukan, retry satu kali hanya untuk
network disconnect atau 502/503/504, dengan backoff/jitter. Jangan retry 400, 404, 409,
atau deterministic payload errors.

## 5. Generic HTTP Client Rules

- Method: GET
- Encode path parameter
- Recommended client timeout: 8 detik; server BPAD budget saat ini 5 detik
- Expected content type: `application/json`
- Do not cache response (`no-store`)
- Log `X-Request-ID`, HTTP status, dan public error code; jangan log payload upstream
- Treat monetary/weight values as decimal strings, not binary floating-point
- Ignore unknown optional fields for forward-compatible clients
- Depend only on fields documented in `docs/openapi.json`

## 6. Handling Responses

| HTTP | Handling |
|---:|---|
| 200 matched | Use documented NJKB/source fields |
| 200 reference_unavailable | Do not substitute another year; show reference unavailable |
| 400 invalid_nopol | Correct client input; no retry |
| 400 unsupported_query_parameter | Remove query parameter; no retry |
| 404 not_found | Vehicle recognized but reference identity absent; no retry loop |
| 409 conflict/ambiguous | Escalate/manual review; do not choose a candidate client-side |
| 429 | Respect `Retry-After`; bounded retry only |
| 500 | Do not repeatedly retry; record request ID |
| 502/504 | External BPAD failure; optionally retry once with jitter |
| 503 | Database unavailable; optionally retry once after delay |

## 7. Idempotency

GET lookup is semantically read-only for consumers. Server may create internal audit
records. Retrying the same GET does not create reference data or alter NJKB, tetapi
consumer harus membatasi retry agar tidak memperbesar load/audit writes.

## 8. Regulatory Behavior

Vehicle year berasal dari BPAD:

- ≤ 2025 → Pergub NTT No. 26 Tahun 2025
- 2026 → Permendagri No. 11 Tahun 2026
- ≥ 2027 → `reference_unavailable` sampai approved edition tersedia

Consumer tidak boleh mengirim atau menginferensikan `tax_year`, mengganti source code,
atau fallback ke nilai adjacent year.

## 9. Browser Integration dan CORS

CORS saat ini disabled. Server-to-server integration direkomendasikan. Browser frontend
dari origin lain akan diblokir browser meskipun request HTTP mungkin mencapai Worker.
Jangan memakai proxy yang menyimpan atau memperluas response tanpa security review.

## 10. Consumer PII Safety

API response tidak mengandung owner PII. Consumer tidak perlu dan tidak boleh menyimpan
raw BPAD payload. NOPOL dapat diperlakukan sebagai vehicle identifier sesuai kebijakan
privacy aplikasi consumer; jangan masukkan NOPOL ke log bila tidak diperlukan.

## 11. Operational Checks

Sebelum mengaktifkan integration:

```sh
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/health
curl -i https://njkb-api-ntt.elwinmusadi.workers.dev/ready
```

Gunakan `docs/production-operations.md` untuk full deployment/smoke/recovery procedure.
