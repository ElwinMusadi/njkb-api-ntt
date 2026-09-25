# Private API Security Monitoring, Observability & Audit Event Model

Dokumen ini mendefinisikan arsitektur pemantauan operasional (*observability*), spesifikasi skema audit event yang aman (*safe audit event model*), taksonomi kategori event keamanan, persyaratan dasbor, serta kebijakan retensi dan privasi log untuk Private API NJKB NTT.

---

## 1. Safe Security Audit Event Schema

Pencatatan aktivitas keamanan pada Private API dirancang dengan prinsip **Zero PII & Zero Secret Exposure**. Log operasional ditujukan untuk visibilitas keandalan sistem dan deteksi intrusi tanpa pernah menyimpan payload sensitif.

### Field yang Diizinkan (*Safe Fields Allowed*)

| Field | Tipe | Deskripsi | Contoh |
|---|---|---|---|
| `timestamp` | string (ISO 8601) | Waktu kejadian dalam UTC | `"2026-09-24T11:03:48.123Z"` |
| `request_id` | string (UUIDv4) | ID korelasi unik per request | `"b7952612-3df8-4255-bb42-b2d40bf076be"` |
| `event_category` | string | Kategori event audit terstandarisasi | `"AUTH_AUTHENTICATED"`, `"AUTH_SCOPE_DENIED"` |
| `principal` | string | Label identitas resmi konsumen yang terverifikasi | `"njkb-api-canary"` |
| `endpoint_class` | string | Pola route tersanitasi (tanpa NOPOL) | `"/api/v1/vehicle/:nopol"`, `"/api/njkb/:nopol"` |
| `http_method` | string | HTTP Method | `"GET"` |
| `http_status` | number | HTTP Response Status Code | `200`, `401`, `403`, `429`, `502`, `503` |
| `auth_result` | string | Status hasil verifikasi autentikasi | `"success"`, `"missing_token"`, `"invalid_signature"` |
| `authz_result` | string | Status hasil evaluasi otorisasi | `"authorized"`, `"denied"` |
| `scopes_granted` | array of string | Daftar scope yang dimiliki konsumen saat request | `["vehicle:read", "njkb:read"]` |
| `required_scope` | string | Scope dasar yang dievaluasi | `"vehicle:read"` |
| `rate_limit_result`| string | Status pengecekan rate limiting | `"allowed"`, `"exceeded"` |
| `error_code` | string (opsional) | Kode error terstandarisasi (jika error) | `"rate_limit_exceeded"`, `"invalid_nopol"` |
| `upstream_status` | string (opsional) | Kategori status BPAD upstream | `"success"`, `"timeout"`, `"http_error"` |
| `duration_ms` | number | Durasi total pemrosesan request dalam ms | `124` |

### Field yang Dilarang Keras Masuk ke Log (*Strictly Prohibited Fields*)

Dilarang keras mencatat atau meneruskan atribut berikut ke log sistem, error trace, atau telemetry:
- Token JWT mentah (baik header, payload, maupun signature).
- Nilai header `Authorization` atau `Cf-Access-Jwt-Assertion`.
- Nilai `CF-Access-Client-Secret` atau rahasia apa pun.
- Kunci privat kriptografi (JWK / RSA key material).
- Data identitas pribadi pemilik: `NamaPemilik`, `NoKTP`, `Alamat`, `Rt`, `Rw`, `Kelurahan`, `Kecamatan`.
- Identitas teknis kendaraan sensitif: `NoBPKB`, `NoRangka`, `NoMesin`.
- Nomor plat kendaraan lengkap (`NOPOL`) pada log URL publik (wajib disanitasi menjadi `/:nopol`).
- Objek payload lengkap BPAD (`bpad.raw`).

---

## 2. Taksonomi Kategori Event Keamanan & Operasional

Untuk memfasilitasi filter, agregasi metrik, dan alert terstruktur, sistem menggunakan kategori event berikut:

| Kategori Event | Tingkat Keparahan | Kondisi Pemicu |
|---|---|---|
| `AUTH_MISSING` | WARN | Request ke endpoint privat tanpa header `Cf-Access-Jwt-Assertion` (atau `Authorization`). |
| `AUTH_INVALID` | WARN | Format token rusak, parsing Base64 gagal, atau klaim JWT malformed. |
| `AUTH_EXPIRED` | INFO / WARN | Token memiliki klaim `exp` yang telah kedaluwarsa melampaui toleransi 30 detik. |
| `AUTH_NOT_YET_VALID` | WARN | Token memiliki klaim `nbf` di masa depan (melebihi toleransi clock 30 detik). |
| `AUTH_ISSUER_MISMATCH` | ERROR | Klaim `iss` tidak cocok persis dengan `https://shy-thunder-ffc9.cloudflareaccess.com`. |
| `AUTH_AUDIENCE_MISMATCH` | ERROR | Klaim `aud` tidak memuat AUD aplikasi resmi. |
| `AUTH_SIGNATURE_INVALID` | ERROR | Tanda tangan kriptografis RS256 gagal diverifikasi terhadap public keys resmi. |
| `AUTH_JWKS_UNAVAILABLE` | CRITICAL | Worker gagal mengunduh atau mem-parsing certs dari endpoint JWKS. |
| `AUTH_UNKNOWN_COMMON_NAME` | WARN / ERROR | Assertion valid namun `common_name` tidak terdaftar di `AUTH_ACCESS_GRANTS_JSON`. |
| `AUTH_SCOPE_DENIED` | WARN | Konsumen terautentikasi namun tidak memiliki scope `vehicle:read` (HTTP 403). |
| `RATE_LIMIT_EXCEEDED` | WARN | Konsumen melampaui batas 60 request per 60 detik pada satu isolate (HTTP 429). |
| `UPSTREAM_BPAD_ERROR` | ERROR | BPAD upstream mengembalikan HTTP non-2xx atau JSON malformed/invalid (HTTP 502). |
| `UPSTREAM_BPAD_TIMEOUT` | ERROR | Panggilan ke BPAD melampaui batas waktu total 5.000 ms (HTTP 504). |
| `NJKB_NOT_FOUND` | INFO | Kendaraan ditemukan di BPAD namun tidak ada referensi NJKB yang cocok. |
| `NJKB_CONFLICT` | WARN | Ditemukan konflik identitas antara data BPAD dan referensi NJKB (HTTP 409). |
| `INTERNAL_ERROR` | CRITICAL | Terjadi unhandled exception atau error matching fatal (HTTP 500). |

---

## 3. Matriks Pemantauan Operasional (Operational Monitoring Matrix)

| Metrik / Area Pantau | Tujuan Pemantauan | Peran Penanggung Jawab (*Owner Role*) | Dasbor yang Diperlukan | Kebijakan Threshold Alert |
|---|---|---|---|---|
| **Laju Penolakan Autentikasi (HTTP 401)** | Mendeteksi kedaluwarsa kredensial massal atau percobaan akses tanpa izin. | Security Owner | Cloudflare Access Analytics / Workers Analytics | **PENDING** *(Menunggu baseline traffic normal)* |
| **Laju Penolakan Otorisasi (HTTP 403)** | Mendeteksi miskonfigurasi hak akses atau percobaan eskalasi scope oleh konsumen. | Security Owner | Workers Observability Dashboard | **PENDING** *(Menunggu baseline)* |
| **Unknown `common_name` Event** | Mendeteksi token Access aktif yang belum dipetakan ke grant Worker. | Cloudflare/Access Owner | Log Stream / Tail Filter | **PENDING** |
| **Kegagalan JWKS (HTTP 503)** | Mendeteksi kegagalan komunikasi antara Worker dan endpoint certs Access. | API Technical Owner | Cloudflare Edge Error Alerts | Segera alert jika > 1 failure dalam 5 menit |
| **Laju Rate Limiting (HTTP 429)** | Mengidentifikasi lonjakan traffic anomali atau kebutuhan penyesuaian kuota konsumen. | API Technical Owner | Workers Analytics | **PENDING** |
| **Error Upstream BPAD (502 / 504)** | Memantau ketersediaan dan latensi portal eksternal BPAD NTT. | API Technical Owner | Workers HTTP Response Dashboard | Segera alert jika 5xx > 5% dalam 15 menit |
| **Latensi Respons (p95 & p99)** | Memastikan SLA respons API tetap dalam batas toleransi wajar (< 3.000 ms). | API Technical Owner | Workers Performance Metrics | **PENDING** |
| **Volume Request per Principal** | Memantau distribusi beban antar-konsumen terdaftar. | Consumer Owner / API Owner | Custom Aggregation Dashboard | **PENDING** |

---

## 4. Peran dan Tanggung Jawab Operasional (Operational Ownership Roles)

Untuk mencegah ketergantungan pada individu spesifik dan memastikan keberlanjutan operasional, tanggung jawab dibagi berdasarkan peran fungsional:

| Peran Fungsional (*Role Placeholder*) | Cakupan Tanggung Jawab Utama |
|---|---|
| **API Technical Owner** | Bertanggung jawab atas ketersediaan runtime Worker, pipeline CI/CD, deployment kode, pemeliharaan arsitektur, dan stabilitas query D1. |
| **Cloudflare/Access Owner** | Bertanggung jawab atas administrasi Zero Trust dashboard, konfigurasi Access Application, penerbitan Service Token, rotasi kunci edge, dan pemeliharaan domain/DNS. |
| **Security Owner** | Bertanggung jawab atas penelaahan permohonan scope konsumen, audit log keamanan berkala, penanganan insiden kebocoran kredensial, dan kepatuhan privasi data. |
| **Consumer Owner** | Bertanggung jawab atas pengelolaan Client Secret di sisi konsumen, kepatuhan batas pemanggilan API, dan pelaporan kebutuhan perubahan integrasi. |
| **Incident Escalation Owner** | Bertanggung jawab mengoordinasikan respons darurat, mitigasi eskalasi (pencabutan token/rollback), dan komunikasi antar-pihak saat insiden operasional. |

---

## 5. Kebijakan Retensi & Privasi Log (Log Retention & Privacy Policy)

1. **Minimisasi Data:** Log Cloudflare Worker saat ini mencatat metadata terstruktur (`event`, `request_id`, `method`, `path`, `result`, `http_status`, `duration_ms`) tanpa menyimpan body request/response atau PII.
2. **Ketiadaan Raw Dump:** Dilarang keras melakukan full payload dump di lingkungan produksi, baik melalui `console.log` sementara maupun middleware logging.
3. **Kebijakan Durasi Retensi (*Log Retention Period*):**
   - Status saat ini: **RETENTION POLICY = PENDING** (Menunggu penetapan regulasi retensi log audit institusional, misal: 90 hari atau 1 tahun).
   - Selama masa transisi, log dipantau secara real-time via `wrangler tail` atau Cloudflare native Workers Log retention sementara (maksimum default Cloudflare dashboard).
4. **Kontrol Akses Log:** Akses ke log audit dan real-time stream hanya diberikan kepada personel yang memegang peran *Security Owner* dan *API Technical Owner*.

---

## 6. Profil Pemantauan Principal Aktif (Active Monitored Principals)

### 1. Principal: `njkb-api-canary`
- **Peran**: Synthetic health checks & continuous automated canary.
- **Volume Normal**: ~1 request/menit (~1.440/hari).
- **Fokus Pantau**: Ketersediaan end-to-end edge-to-BPAD, latensi p95, status HTTP 200 konstan.
- **Alert Threshold**: PENDING.

### 2. Principal: `kalkulator-pajak-kendaraan`
- **Peran**: Consumer produksi lookup kendaraan + NJKB (Kalkulator Pajak Kendaraan).
- **Volume Normal**: ~500 request/hari.
- **Expected Scope Set**: `vehicle:read`, `registration:read`, `owner:read`, `tax:read`, `njkb:read`.
- **Forbidden Scopes**: `bpad:raw`, `vehicle:full`.
- **Fokus Pantau**:
  - Lonjakan HTTP 401 (kedaluwarsa token / kegagalan Access).
  - HTTP 403 (percobaan eskalasi atau akses scope terlarang `bpad:raw` atau `vehicle:full`).
  - HTTP 429 (melebihi rate limit 60 req/menit/isolate).
  - BPAD upstream failure (HTTP 502 / 504).
  - Worker internal error (HTTP 500).
  - Latensi request (target < 3.000 ms).
  - Anomali autentikasi/otorisasi yang tidak diharapkan.
- **Alert Threshold**: PENDING *(Menunggu baseline traffic normal pasca aktivasi produksi)*.

