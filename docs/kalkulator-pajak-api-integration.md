# Panduan Integrasi API — Kalkulator Pajak Kendaraan

Dokumen ini adalah panduan integrasi **server-to-server** untuk consumer produksi `Kalkulator Pajak Kendaraan`.

## 1. Base URL dan Endpoint

### Base URL produksi

```text
https://api.uptdpenda-kupang.web.id
```

### Endpoint lookup kendaraan

```http
GET /api/v1/vehicle/{nopol}
```

Contoh:

```text
https://api.uptdpenda-kupang.web.id/api/v1/vehicle/DH4786PD
```

Parameter:

| Parameter | Lokasi | Wajib | Keterangan |
|---|---|---:|---|
| `nopol` | Path | Ya | Nomor polisi kendaraan. Input dinormalisasi menjadi huruf kapital tanpa spasi atau tanda hubung. Format akhir: 1–2 huruf, 1–4 angka, dan 0–3 huruf, misalnya `DH4786PD`. |

Endpoint tidak menerima query parameter. Request seperti berikut ditolak dengan HTTP 400:

```text
/api/v1/vehicle/DH4786PD?tax_year=2026
```

Tahun kendaraan dan referensi NJKB ditentukan oleh data BPAD serta aturan regulasi server. Consumer tidak boleh mengirim `tax_year`, edition, atau fallback tahun sendiri.

## 2. Authentication

API menggunakan **Cloudflare Access Service Auth**. Integrasi harus berjalan dari backend/server yang dapat menjaga kerahasiaan Service Token.

Kirim dua header berikut pada setiap request:

```http
CF-Access-Client-Id: 258c62aadaa1dad3ca33f871d8439a88.access
CF-Access-Client-Secret: <AMBIL_DARI_SECURE_STORAGE_OPERATOR>
```

Identitas consumer:

| Atribut | Nilai |
|---|---|
| Service Token | `Kalkulator Pajak Service Token` |
| Client ID / Access `common_name` | `258c62aadaa1dad3ca33f871d8439a88.access` |
| Principal Worker | `kalkulator-pajak-kendaraan` |
| Scope | `vehicle:read`, `registration:read`, `owner:read`, `tax:read`, `njkb:read` |

### Penanganan Client Secret

Client Secret sudah diterbitkan bersama Service Token, tetapi nilainya **tidak disimpan dalam repository atau dokumentasi ini**. Ambil nilainya dari secure storage/operator environment yang digunakan saat token dibuat.

Aturan wajib:

- Simpan Client Secret hanya di secret manager atau environment variable backend.
- Jangan menyimpan Client Secret di source code, repository, database aplikasi, dokumentasi, atau log.
- Jangan mengirim Service Token langsung dari browser, aplikasi mobile, atau JavaScript frontend.
- Jangan memakai prefix environment variable yang diekspos ke frontend seperti `VITE_`, `NEXT_PUBLIC_`, atau padanan framework lain.
- Jangan membuat atau mengirim header `Cf-Access-Jwt-Assertion` sendiri. Cloudflare Access membuat assertion tersebut setelah Service Token diterima.
- Jangan memakai header `Authorization: Bearer ...`; endpoint ini menggunakan dua header Cloudflare Access di atas.

Alur autentikasi:

```text
Backend Kalkulator Pajak
  -> CF-Access-Client-Id + CF-Access-Client-Secret
  -> Cloudflare Access Service Auth
  -> Cf-Access-Jwt-Assertion
  -> Worker memverifikasi RS256, issuer, audience, exp/nbf, dan common_name
  -> principal kalkulator-pajak-kendaraan
  -> evaluasi scope
  -> lookup kendaraan + NJKB
```

## 3. Contoh Request

### cURL

Gunakan environment variable agar secret tidak tertulis di command history:

```sh
export NJKB_ACCESS_CLIENT_ID='258c62aadaa1dad3ca33f871d8439a88.access'
export NJKB_ACCESS_CLIENT_SECRET='<nilai-dari-secure-storage>'

curl --fail-with-body \
  --max-time 8 \
  -H "Accept: application/json" \
  -H "CF-Access-Client-Id: ${NJKB_ACCESS_CLIENT_ID}" \
  -H "CF-Access-Client-Secret: ${NJKB_ACCESS_CLIENT_SECRET}" \
  "https://api.uptdpenda-kupang.web.id/api/v1/vehicle/DH4786PD"
```

### JavaScript / TypeScript (backend Node.js)

```ts
const baseUrl = 'https://api.uptdpenda-kupang.web.id';
const clientId = process.env.NJKB_ACCESS_CLIENT_ID;
const clientSecret = process.env.NJKB_ACCESS_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  throw new Error('Cloudflare Access credentials are not configured');
}

export async function lookupVehicle(nopol: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/vehicle/${encodeURIComponent(nopol)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret,
        },
        signal: controller.signal,
      },
    );

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw Object.assign(new Error(`NJKB API returned HTTP ${response.status}`), {
        httpStatus: response.status,
        requestId: response.headers.get('x-request-id'),
        body,
      });
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}
```

### PHP / Laravel

Simpan konfigurasi backend berikut di `.env` deployment dan jangan commit file tersebut:

```dotenv
NJKB_API_BASE_URL=https://api.uptdpenda-kupang.web.id
NJKB_ACCESS_CLIENT_ID=258c62aadaa1dad3ca33f871d8439a88.access
NJKB_ACCESS_CLIENT_SECRET=<nilai-dari-secure-storage>
```

Contoh request Laravel:

```php
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

$nopol = 'DH4786PD';

$response = Http::acceptJson()
    ->withHeaders([
        'CF-Access-Client-Id' => config('services.njkb.client_id'),
        'CF-Access-Client-Secret' => config('services.njkb.client_secret'),
    ])
    ->connectTimeout(3)
    ->timeout(8)
    ->get(
        rtrim(config('services.njkb.base_url'), '/') .
        '/api/v1/vehicle/' . rawurlencode($nopol)
    );

$contentType = $response->header('Content-Type', '');
$body = str_contains($contentType, 'application/json')
    ? $response->json()
    : null;

if ($response->successful() && ($body['status'] ?? null) === 'vehicle_found') {
    $namaPemilik = data_get($body, 'owner.name');
    $njkb = data_get($body, 'njkb.value');
    $jatuhTempoPajak = data_get($body, 'tax.notice_valid_until');
    $jatuhTempoStnk = data_get($body, 'registration.stnk_valid_until');
} else {
    // Jangan log response body karena dapat berisi PII.
    Log::warning('NJKB API request failed', [
        'request_id' => $response->header('X-Request-ID'),
        'http_status' => $response->status(),
        'status' => data_get($body, 'status'),
        'error_code' => data_get($body, 'error.code'),
    ]);
}
```

Contoh `config/services.php`:

```php
'njkb' => [
    'base_url' => env('NJKB_API_BASE_URL'),
    'client_id' => env('NJKB_ACCESS_CLIENT_ID'),
    'client_secret' => env('NJKB_ACCESS_CLIENT_SECRET'),
],
```

## 4. Contoh Response JSON

Contoh berikut memakai data sintetis untuk menunjukkan kontrak response. Ini bukan data kendaraan atau pemilik nyata. Nilai aktual dapat berbeda dan beberapa field dapat bernilai `null`.

```json
{
  "status": "vehicle_found",
  "vehicle_status": "found",
  "njkb_status": "matched",
  "nopol": "DH0001XX",
  "vehicle": {
    "category": "MOBIL PENUMPANG",
    "category_raw": "MINIBUS",
    "category_code": "103",
    "brand": "HONDA",
    "brand_code": "167",
    "type": "CONTOH MODEL 1.5 M/T",
    "type_code": "103167 00001",
    "year": 2024,
    "color": "PUTIH",
    "plate_color": "HITAM",
    "fuel": "BENSIN",
    "fuel_code": "01",
    "engine_capacity_cc": 1496,
    "chassis_number": "SYNTHETIC-CHASSIS",
    "engine_number": "SYNTHETIC-ENGINE",
    "body_modification": "[ --- TIDAK ADA PERUBAHAN --- ]"
  },
  "registration": {
    "bpkb_number": "SYNTHETIC-BPKB",
    "previous_nopol": null,
    "stnk_valid_until": "2031-12-31",
    "previous_stnk_date": "2030-12-31",
    "invoice_date": "2024-01-01",
    "plate_color": "HITAM",
    "usage": "PRIBADI",
    "usage_code": "2"
  },
  "tax": {
    "notice_valid_until": "2030-12-31",
    "previous_pkb_date": "2029-12-31",
    "kohir": "SYNTHETIC-KOHIR"
  },
  "owner": {
    "name": "PEMILIK CONTOH",
    "identity_number": "0000000000000000",
    "address": "ALAMAT CONTOH",
    "rt": "001",
    "rw": "002",
    "village": "KELURAHAN CONTOH",
    "district": "KECAMATAN CONTOH",
    "village_code": null,
    "district_code": null,
    "postal_code": null,
    "ownership_code": "02",
    "ownership_description": "PEMBELIAN BARU",
    "business_type": null,
    "business_name": null,
    "business_number": null,
    "business_license_number": null
  },
  "administrative": {
    "origin_upt": "UPT CONTOH",
    "origin_location_code": "010",
    "dealer_code": "016",
    "dealer_name": "DEALER CONTOH",
    "skum": null,
    "codes": {
      "kd_dump": null,
      "kd_jr": null,
      "ke": null
    },
    "labels": {
      "k_jr": null
    }
  },
  "bpad": {
    "code": "1",
    "status": "success",
    "message": "Data ditemukan"
  },
  "njkb": {
    "value": "150000000.00",
    "weight": "1.050000",
    "dpp_pkb": "157500000.00"
  },
  "match": {
    "method": "exact_code_year_and_brand_type",
    "source_code": "103167 00001"
  },
  "source": {
    "regulation": "Pergub NTT No. 26 Tahun 2025",
    "pdf_page": 181,
    "source_row": "2587"
  }
}
```

### Field yang digunakan Kalkulator Pajak

| Kebutuhan | Field API |
|---|---|
| NOPOL | `nopol` |
| Nama pemilik | `owner.name` |
| NJKB | `njkb.value` |
| Bobot | `njkb.weight` |
| DPP PKB | `njkb.dpp_pkb` |
| Informasi ubah bentuk | `vehicle.body_modification` |
| Jenis kendaraan | `vehicle.category`, `vehicle.type` |
| Jatuh tempo pajak / SD Notice | `tax.notice_valid_until` |
| Tanggal PKB sebelumnya | `tax.previous_pkb_date` |
| Kohir | `tax.kohir` |
| Jatuh tempo STNK | `registration.stnk_valid_until` |
| Warna TNKB | `registration.plate_color` |
| Penggunaan kendaraan | `registration.usage` |

Catatan:

- `vehicle.body_modification` adalah deskripsi ubah bentuk dari BPAD (`RubahBentuk`), bukan angka nominal NJKB.
- Nilai uang (`njkb.value`, `njkb.dpp_pkb`) dan bobot dikirim sebagai **decimal string**. Jangan mengolah nilai tersebut menggunakan binary floating point. Gunakan decimal/bignumber atau integer Rupiah sesuai kebutuhan aplikasi.
- `tax.notice_valid_until`, `tax.previous_pkb_date`, dan `registration.stnk_valid_until` menggunakan format `YYYY-MM-DD` atau `null`.
- `bpad.raw` tidak diberikan kepada consumer ini.
- Response mengandung data pribadi dan identifier sensitif. Jangan mencatat seluruh response ke log dan jangan menyimpan field yang tidak diperlukan.

## 5. Status NJKB

`vehicle_status` dan `njkb_status` dipisahkan. Jika kendaraan ditemukan di BPAD, HTTP response tetap 200, sedangkan hasil pencocokan NJKB dijelaskan oleh `njkb_status`:

| `njkb_status` | Arti |
|---|---|
| `matched` | Referensi NJKB ditemukan. `njkb`, `match`, dan `source` berisi data. |
| `not_found` | Kendaraan ditemukan, tetapi referensi NJKB tidak ditemukan. `njkb`, `match`, dan `source` dapat bernilai `null`. |
| `reference_unavailable` | Belum ada edisi regulasi yang berlaku untuk tahun/kategori kendaraan. Jangan fallback ke tahun lain. |
| `conflict` | Identitas kendaraan bertentangan dengan referensi. Jangan memilih nilai sendiri. |
| `ambiguous` | Lebih dari satu kandidat referensi; perlu penanganan/manual review. |

Aplikasi harus memeriksa `njkb_status`, bukan hanya HTTP 200.

## 6. Error Response dan Penanganan

Contoh error JSON dari Worker:

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

| HTTP | Kondisi | Penanganan consumer |
|---:|---|---|
| 200 | Kendaraan ditemukan; periksa `njkb_status` | Gunakan hanya field yang dibutuhkan. |
| 400 | NOPOL tidak valid atau query parameter tidak didukung | Perbaiki request; jangan retry otomatis. |
| 401 | Service Token hilang/tidak valid, atau assertion ditolak | Verifikasi secret/configuration. Response dari Cloudflare Access dapat berupa HTML, bukan JSON. |
| 403 | Principal terautentikasi tetapi scope dasar ditolak | Hentikan request dan laporkan konfigurasi otorisasi. |
| 429 | Rate limit terlampaui | Hormati header `Retry-After`; retry terbatas. |
| 500 | Kesalahan internal/matching | Catat `X-Request-ID`; jangan retry berulang. |
| 502 | Upstream BPAD gagal, response tidak valid, atau network failure | Boleh retry satu kali dengan backoff dan jitter. |
| 503 | Database/JWKS/auth provider tidak tersedia | Boleh retry satu kali setelah jeda. |
| 504 | Upstream BPAD melewati timeout | Boleh retry satu kali dengan backoff dan jitter. |

Jangan log Client Secret, header autentikasi, NOPOL, payload response, Nama Pemilik, NIK, NoBPKB, NoRangka, atau NoMesin. Untuk korelasi masalah, log hanya:

- `X-Request-ID`
- HTTP status
- `status`
- `error.code`
- durasi request

## 7. Rate Limit, Timeout, dan Quota

| Kontrol | Nilai |
|---|---|
| Rate limit | 60 request per 60 detik |
| Rate-limit key | Principal `kalkulator-pajak-kendaraan` |
| Distribusi | Per Worker isolate; bukan quota global terdistribusi |
| Upstream BPAD timeout | 5 detik |
| Recommended client timeout | 8 detik |
| Expected consumer traffic | ±500 request/hari |
| Daily quota | Tidak ada quota harian terpisah yang didokumentasikan |

Jika menerima HTTP 429, baca header `Retry-After` dan jangan melakukan retry loop tanpa batas.

Rekomendasi retry:

- Maksimum satu retry untuk network disconnect, HTTP 502, 503, atau 504.
- Gunakan backoff dan jitter.
- Jangan retry HTTP 400, 401, 403, atau error deterministik.
- Jangan melakukan polling cepat terhadap kendaraan yang sama.

## 8. Security dan Deployment Checklist

Sebelum integrasi diaktifkan:

- [ ] Client Secret tersedia di secret manager backend.
- [ ] Request dilakukan dari backend, bukan browser/mobile client.
- [ ] Header Service Token terpasang pada setiap request.
- [ ] Timeout client diset sekitar 8 detik.
- [ ] HTTP 401 non-JSON dari Cloudflare Access dapat ditangani.
- [ ] Aplikasi memeriksa `njkb_status` pada HTTP 200.
- [ ] Nilai Rupiah diproses sebagai decimal string/integer, bukan float.
- [ ] PII, NOPOL, secret, header auth, dan response lengkap tidak masuk log.
- [ ] Response tidak di-cache (`Cache-Control: no-store`).
- [ ] HTTP 429 menghormati `Retry-After`.
- [ ] Retry hanya terbatas untuk gangguan transien.

## 9. CORS dan Arsitektur Integrasi

CORS API dinonaktifkan. Integrasi langsung dari browser pada origin lain tidak didukung. Arsitektur yang benar:

```text
Frontend Kalkulator Pajak
  -> Backend Kalkulator Pajak
  -> Private NJKB API
```

Backend bertanggung jawab menjaga Service Token dan hanya meneruskan data minimum yang dibutuhkan frontend.

## 10. Health Check

Endpoint health tidak memerlukan Service Token:

```text
GET https://api.uptdpenda-kupang.web.id/health
GET https://api.uptdpenda-kupang.web.id/ready
```

- `/health` memeriksa proses Worker.
- `/ready` memeriksa kesiapan Worker dan konektivitas D1.

Health check tidak menggantikan canary authenticated terhadap `/api/v1/vehicle/{nopol}`.
