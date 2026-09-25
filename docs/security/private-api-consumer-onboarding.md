# Private API Consumer Onboarding Runbook & Lifecycle Policy

Dokumen ini mendefinisikan tata kelola operasional, alur onboarding, kebijakan *least privilege*, manajemen kredensial, rotasi, pencabutan (*revocation*), dan *decommissioning* untuk konsumen Private API NJKB NTT (`GET /api/v1/vehicle/{nopol}`).

---

## 1. Prinsip Utama

1. **Service-to-Service Only:** Konsumen adalah sistem/aplikasi beridentitas mandiri, bukan pengguna perorangan (human user).
2. **Identitas Terisolasi (No Shared Credentials):** Setiap konsumen wajib memiliki Cloudflare Access Service Token dan principal terpisah. Dilarang keras menggunakan satu Service Token bersama-sama antar-aplikasi.
3. **Pemisahan Kredensial dan Otorisasi:**
   - Kredensial (Service Token Client ID & Secret) diterbitkan dan divalidasi oleh Cloudflare Access pada *edge boundary*.
   - Hak akses data (scope) ditentukan dan ditegakkan secara independen oleh Worker melalui konfigurasi `AUTH_ACCESS_GRANTS_JSON`.
   - Memiliki Service Token valid **tidak otomatis memberikan akses data** jika principal belum terdaftar dan diotorisasi.
4. **Least Privilege by Default:** Scope diberikan secara minimal sesuai kebutuhan bisnis dan teknis konsumen. `vehicle:full` bukan default dan memerlukan persetujuan khusus.
5. **Kerahasiaan Kredensial (Zero Secret in Worker/Git):** Client Secret Service Token **tidak pernah** disimpan di repositori git, source code, environment variable Worker, log, atau database D1. Client Secret hanya disimpan di secret manager milik konsumen.

---

## 2. Alur Siklus Hidup Konsumen (Consumer Lifecycle)

```text
1. PERMOHONAN (REQUEST)
       ↓
2. PENELAAHAN (LEAST-PRIVILEGE REVIEW)
       ↓
3. PERSETUJUAN (APPROVAL)
       ↓
4. PEMBUATAN SERVICE TOKEN (ACCESS CONFIGURATION)
       ↓
5. PENYERAHAN KREDENSIAL AMAN (SECURE HANDOFF)
       ↓
6. REGISTRASI PRINCIPAL & SCOPE GRANT (WORKER CONFIG)
       ↓
7. PENGUJIAN CANARY (CONTROLLED CANARY TEST)
       ↓
8. AKTIVASI PRODUKSI (PRODUCTION ACTIVATION)
       ↓
9. PEMANTAUAN OPERASIONAL (MONITORING & AUDIT)
       ↓
10. ROTASI BERKALA (CREDENTIAL ROTATION)
       ↓
11. PENCABUTAN / OFFBOARDING (REVOCATION / DECOMMISSION)
```

### Tahap 1: Permohonan (Request)
Pemilik sistem pemohon (*Consumer Owner*) mengajukan permohonan integrasi tertulis kepada *API Technical Owner* yang memuat:
- Nama sistem / aplikasi konsumen (contoh: SIPAS, Sistem Pendataan Pajak Daerah).
- Deskripsi teknis dan tujuan integrasi.
- Identitas *Consumer Owner* dan kontak operasional 24/7.
- Daftar scope data spesifik yang diminta beserta justifikasi bisnis.
- Estimasi volume panggilan (request per menit / request per hari).

### Tahap 2: Penelaahan (Review)
*Security Owner* dan *API Technical Owner* menelaah permohonan:
- Memverifikasi prinsip *least privilege* (apakah data yang diminta benar-benar esensial).
- Memeriksa apakah data pemilik (`owner:read`) atau raw BPAD (`bpad:raw`) benar-benar diperlukan secara legal dan operasional.
- Menentukan label principal permanen (format: `[a-z0-9._:-]{1,128}`).

### Tahap 3: Persetujuan (Approval)
*Authorization Approver* memberikan persetujuan formal terhadap daftar scope final.

### Tahap 4: Pembuatan Service Token di Cloudflare Access
*Cloudflare/Access Owner* membuat Service Token baru di Cloudflare Zero Trust:
- **Nama Token:** Mengikuti format `njkb-api-<consumer_name>` (contoh: `njkb-api-sipas`).
- **Masa Berlaku:** Sesuai kebijakan masa berlaku token (misal: 1 tahun, atau sesuai kontrak).
- **Service Auth Policy:** Memasukkan Service Token ke dalam Access Policy aplikasi `API Kendaraan BPAD NTT`.
- **Pencatatan Non-Secret:** Mencatat nama token dan Client ID (`<hash>.access`).

### Tahap 5: Penyerahan Kredensial Aman (Secure Handoff)
- Client Secret **hanya ditampilkan satu kali** oleh dashboard Cloudflare saat pembuatan.
- Client Secret diserahkan kepada *Consumer Owner* melalui kanal komunikasi terenkripsi atau secret manager institusional yang disetujui.
- **Dilarang keras** mengirimkan Client Secret melalui email polos, chat publik, atau tiket tidak terenkripsi.

### Tahap 6: Registrasi Principal & Scope Grant
*API Technical Owner* mendaftarkan relasi `access_common_name` -> `principal` -> `scopes` ke dalam konfigurasi `AUTH_ACCESS_GRANTS_JSON` pada environment `production` Worker melalui prosedur perubahan rilis terkontrol:
```json
{
  "access_common_name": "<client_id>.access",
  "principal": "njkb-api-<consumer>",
  "scopes": ["vehicle:read", "njkb:read"]
}
```
*Catatan:* Setiap entri grant wajib menyertakan `vehicle:read` atau `vehicle:full`.

### Tahap 7: Pengujian Canary Terkontrol
Konsumen melakukan uji coba awal pada endpoint privat menggunakan skrip pengujian terkendali:
- Memverifikasi HTTP 200 untuk pemanggilan sah.
- Memverifikasi data yang diterima sesuai scope yang diizinkan.
- Memverifikasi field di luar scope **tidak hadir** di dalam payload JSON.
- Memverifikasi respons membawa `Cache-Control: no-store` dan `X-Request-ID`.

### Tahap 8: Aktivasi Produksi
Setelah uji coba canary dinyatakan lolos tanpa anomali, status konsumen diubah menjadi `ACTIVE`.

### Tahap 9: Pemantauan Operasional
Metrik dan log aktivitas konsumen dipantau secara berkala (laju request, error rate 401/403/429/502).

---

## 3. Matriks Permohonan & Rekomendasi Scope

| Kebutuhan Integrasi Konsumen | Scope Minimal yang Diizinkan | Scope yang Dilarang Diberikan |
|---|---|---|
| **Lookup Kendaraan Dasar**<br>Verifikasi data fisik kendaraan (merek, tipe, tahun, warna, CC). | `vehicle:read` | `registration:read`<br>`tax:read`<br>`owner:read`<br>`bpad:raw` |
| **Lookup NJKB & Nilai Pajak**<br>Penghitungan pajak kendaraan, simulasi PKB/BBNKB. | `vehicle:read`<br>`njkb:read` | `registration:read`<br>`tax:read`<br>`owner:read`<br>`bpad:raw` |
| **Pengecekan Masa Pajak**<br>Integrasi status jatuh tempo notice pajak. | `vehicle:read`<br>`tax:read` | `owner:read`<br>`registration:read`<br>`bpad:raw` |
| **Administrasi Registrasi & Identifikasi Teknis**<br>Penatausahaan BPKB, cek fisik nomor rangka/mesin. | `vehicle:read`<br>`registration:read` | `owner:read`<br>`bpad:raw` |
| **Layanan Terpadu Kepemilikan (Khusus Otoritas Berwenang)**<br>Verifikasi identitas pemilik, NIK, alamat. | `vehicle:read`<br>`owner:read` | `bpad:raw` |
| **Integrasi Diagnostik / Forensik Raw**<br>Sistem audit internal Samsat / rekonsiliasi data mentah. | `vehicle:read`<br>`bpad:raw` | Sesuai justifikasi tambahan |
| **Full Bundle (Hanya Sistem Inti / Samsat Terpadu)**<br>Akses seluruh section data. | `vehicle:full` *(ekspansi eksak ke 6 scope)* | Dilarang untuk pihak ketiga / non-inti |

---

## 4. Kebijakan Rotasi Kredensial (Credential Rotation Policy)

Rotasi kredensial Service Token wajib dilakukan secara berkala (misal: tiap 12 bulan) atau segera jika dicurigai adanya kompromi kredensial:

```text
1. GENERATE NEW SECRET (Cloudflare Access Dashboard)
       ↓
2. SECURE DISTRIBUTION TO CONSUMER
       ↓
3. CONSUMER APPLIES NEW SECRET IN PARALLEL
       ↓
4. VERIFY SMOKE TEST WITH NEW CREDENTIAL
       ↓
5. CONSUMER CUTOVER
       ↓
6. EXPIRE / REVOKE OLD SECRET
```

1. **Dukungan Fitur Rotasi Cloudflare Access:** Cloudflare Access mendukung *secret rotation* dengan masa tenggang (*grace period*), di mana secret lama dan secret baru dapat aktif bersamaan untuk transisi tanpa *downtime*.
2. **Prosedur:**
   - *Cloudflare/Access Owner* membuat secret baru pada Service Token terkait di dashboard Access, mengatur grace period yang wajar (misal: 7 hari).
   - Secret baru diserahkan secara aman kepada *Consumer Owner*.
   - Konsumen memperbarui konfigurasi di secret manager mereka dan melakukan uji coba.
   - Setelah cutover tuntas dan dipastikan tidak ada request yang memakai secret lama, secret lama dihapus/dicabut di Cloudflare Access.

---

## 5. Kebijakan & Prosedur Pencabutan (Revocation & Offboarding Policy)

### Pemicu Pencabutan (Revocation Triggers)
- Kredensial terindikasi bocor, dicuri, atau terekspos ke publik/log.
- Sistem konsumen mengalami insiden keamanan (*security breach*).
- Kerja sama integrasi berakhir (*decommissioning*).
- Terdeteksi pola penyalahgunaan (*abuse*) atau pelanggaran batas scope.
- Permintaan formal dari pemilik data atau instansi pengawas.

### Prosedur Pencabutan Darurat (Emergency Revocation Procedure)
Dalam kondisi insiden keamanan, waktu respons adalah hal utama:

```text
DETEKSI INSIDEN
       ↓
TINDAKAN 1: DISABLE / DELETE SERVICE TOKEN DI ACCESS (Immediate Block pada Edge)
       ↓
TINDAKAN 2: VERIFIKASI BLOKIR (Request langsung menerima HTTP 401)
       ↓
TINDAKAN 3: HAPUS GRANT DARI AUTH_ACCESS_GRANTS_JSON WORKER
       ↓
TINDAKAN 4: INVESTIGASI FORENSIK & AUDIT AKSES
```

1. **Langkah 1 (Immediate Edge Block):** *Cloudflare/Access Owner* segera mengubah status Service Token menjadi **Disabled** atau langsung **Delete** di dashboard Cloudflare Access. Perubahan ini efektif dalam hitungan detik secara global di edge Cloudflare.
2. **Langkah 2 (Verifikasi):** Lakukan request uji coba menggunakan kredensial tersebut, pastikan Cloudflare Access langsung menolak dengan HTTP 401.
3. **Langkah 3 (Pembersihan Grant):** *API Technical Owner* memperbarui `AUTH_ACCESS_GRANTS_JSON` pada Worker untuk menghapus entri principal terkait, melakukan review diff, dan men-deploy Worker.
4. **Langkah 4 (Pelaporan):** Mencatat waktu insiden, identitas token, alasan pencabutan, dan dampak ke dalam register insiden keamanan.

---

## 6. Model Registri Konsumen (Consumer Registry Model)

Registri konsumen saat ini dikelola secara deklaratif melalui environment variable production Worker: `AUTH_ACCESS_GRANTS_JSON`.

### Struktur Data Registri Logis
Setiap entri konsumen memuat atribut:
```json
{
  "access_common_name": "d6bb9db60e9cd5ee91327eed387cf2fb.access",
  "principal": "njkb-api-canary",
  "scopes": ["vehicle:read", "njkb:read"]
}
```

Metadata operasional yang wajib dipelihara secara terpisah di dokumen operasional internal (tidak di dalam Worker runtime):
- `consumer_id`: UUID unik konsumen.
- `consumer_name`: Nama resmi sistem/aplikasi.
- `owner_role`: Unit penanggung jawab.
- `contact_email`: Kontak teknis penanggung jawab.
- `service_token_name`: Nama token di Cloudflare Access.
- `access_common_name`: Nilai Client ID (`<hash>.access`).
- `principal_label`: Label principal di Worker.
- `granted_scopes`: Array scope yang disetujui.
- `status`: `ACTIVE` | `SUSPENDED` | `REVOKED`.
- `created_at`: Timestamp persetujuan awal.
- `last_rotated_at`: Timestamp rotasi kredensial terakhir.

*Catatan Arsitektur:* Untuk skala saat ini, konfigurasi deklaratif `AUTH_ACCESS_GRANTS_JSON` adalah solusi paling aman, cepat, dan idempoten tanpa beban overhead pemeliharaan tabel D1 baru. Migrasi ke tabel database D1 hanya akan dipertimbangkan jika jumlah konsumen aktif telah melampaui batas praktis konfigurasi JSON (>100 konsumen).

---

## 7. Status Konsumen Canary Eksisting

Token yang saat ini aktif di production:
- **Nama Token:** `njkb-api-canary`
- **Access common_name:** `d6bb9db60e9cd5ee91327eed387cf2fb.access`
- **Principal:** `njkb-api-canary`
- **Scope:** `vehicle:read`, `njkb:read`
- **Peran:** **SYSTEM TEST / CANARY VERIFICATION ONLY**.
- **Aturan Operasional:** Token ini dialokasikan khusus untuk verifikasi kesehatan sistem, automated synthetic monitoring, dan smoke test rilis oleh *API Technical Owner*. Kredensial ini **tidak boleh diserahkan atau dibagikan** kepada konsumen bisnis mana pun.

---

## 8. Checklist Onboarding Konsumen Baru (Untuk Eksekusi Masa Depan)

- [ ] Formulir permohonan integrasi diterima lengkap dengan justifikasi scope.
- [ ] Penelaahan least privilege tuntas (data sensitif diverifikasi secara ketat).
- [ ] Persetujuan formal dari *Authorization Approver* tercatat.
- [ ] Service Token baru dibuat di Cloudflare Access dengan nama standar.
- [ ] Service Auth Policy diperbarui untuk memasukkan token baru.
- [ ] Client Secret diserahkan secara aman kepada konsumen (tidak ada di email/chat terbuka).
- [ ] Client ID (`common_name`) didaftarkan ke `AUTH_ACCESS_GRANTS_JSON`.
- [ ] Entri grant menyertakan `vehicle:read` atau `vehicle:full`.
- [ ] Pengujian canary privat berhasil (HTTP 200, isolasi field terverifikasi).
- [ ] Log pemanggilan diverifikasi (tidak ada kebocoran rahasia atau PII).
- [ ] Register metadata konsumen diperbarui dengan status `ACTIVE`.

---

## 9. Registri Konsumen Produksi: Kalkulator Pajak Kendaraan

| Atribut | Nilai Operasional |
|---|---|
| **Consumer Name** | Kalkulator Pajak Kendaraan |
| **Principal Identifier** | `kalkulator-pajak-kendaraan` |
| **Status** | `ACTIVE` |
| **Endpoint Target** | `GET /api/v1/vehicle/{nopol}` |
| **Tujuan Bisnis** | Perhitungan taksasi pajak kendaraan (PKB, Opsen PKB, SWDKLLJ, PNBP, Tax Amnesty) dan verifikasi data kendaraan. |
| **Approved Scopes** | `vehicle:read`, `registration:read`, `owner:read`, `tax:read`, `njkb:read` |
| **Forbidden Scopes** | `bpad:raw`, `vehicle:full` |
| **Data Fields Terbuka** | `vehicle` (merek, tipe, cc, nomor rangka, nomor mesin, modifikasi bentuk/RubahBentuk, warna TNKB), `registration` (nomor BPKB, jatuh tempo STNK/SD_STNK, warna TNKB, penggunaan kendaraan/GUNA), `administrative`, `owner` (nama pemilik/NamaPemilik, NIK, alamat), `tax` (jatuh tempo pajak/SD_NOTICE, tanggal PKB lalu/TglPKBLalu, kohir), `njkb` (nilai, match, sumber). |
| **Data Fields Tertutup** | `bpad.raw` (payload JSON mentah upstream BPAD). |
| **Service Token Name** | `Kalkulator Pajak Service Token` |
| **Access common_name** | `258c62aadaa1dad3ca33f871d8439a88.access` |
| **Expected Traffic** | ~500 request/hari |
| **Rate Limit** | 60 requests / 60 seconds / principal / isolate |
| **Technical Contact** | Application Technical Owner / Developer |

### Justifikasi Remediasi Scope (`tax:read`)
Pada aktivasi awal, scope `tax:read` tidak diberikan. Namun evaluasi kebutuhan bisnis membuktikan bahwa aplikasi Kalkulator Pajak Kendaraan secara mandatori memerlukan **SD_NOTICE** (jatuh tempo notice pajak) sebagai input penentu perhitungan denda, masa berlaku, dan tunggakan pajak kendaraan bermotor.
- Field BPAD `SD_NOTICE` dinormalisasi oleh Worker menjadi `tax.notice_valid_until`.
- Kontrak API memproteksi section `tax` di bawah scope `tax:read`.
- Field `SD_STNK` (jatuh tempo STNK) yang berada di bawah `registration:read` **tidak dapat menggantikan** fungsi `SD_NOTICE`.
- Oleh karena itu, scope `tax:read` disetujui dan ditambahkan secara resmi ke grant consumer `kalkulator-pajak-kendaraan`.
- **Inventori Field Scope `tax:read`:** Sesuai kontrak `src/bpad/normalize.ts` dan `src/private-api/contracts.ts`, pemberian `tax:read` mengekspos field:
  1. `tax.notice_valid_until` (dari BPAD `SD_NOTICE`)
  2. `tax.previous_pkb_date` (dari BPAD `TglPKBLalu`)
  3. `tax.kohir` (dari BPAD `Kohir`)
- Scope `bpad:raw` dan `vehicle:full` **tetap dilarang keras**.

Konfigurasi grant terpasang pada `AUTH_ACCESS_GRANTS_JSON` (`wrangler.jsonc` production):
```json
[
  {
    "access_common_name": "d6bb9db60e9cd5ee91327eed387cf2fb.access",
    "principal": "njkb-api-canary",
    "scopes": ["vehicle:read", "njkb:read"]
  },
  {
    "access_common_name": "258c62aadaa1dad3ca33f871d8439a88.access",
    "principal": "kalkulator-pajak-kendaraan",
    "scopes": ["vehicle:read", "registration:read", "owner:read", "tax:read", "njkb:read"]
  }
]
```

*Catatan Keamanan (Zero Secret Exposure):* Client Secret untuk Service Token `Kalkulator Pajak Service Token` dikelola secara terisolasi di secret manager konsumen dan tidak pernah dicatat atau disimpan di dalam repositori ini.

---

## 10. Panduan Langkah Manual Cloudflare Zero Trust Dashboard

Karena Cloudflare API token default Wrangler tidak memiliki izin administratif Cloudflare Zero Trust (`403 Forbidden` pada `/access/apps` dan `/access/service_tokens`), pembuatan Service Token dilakukan secara mandiri oleh Operator melalui dashboard Zero Trust:

1. Buka browser dan login ke **Cloudflare One / Zero Trust**:
   - URL: `https://one.dash.cloudflare.com/`
2. Navigasi ke menu **Access** -> **Service Auth**:
   - Pilih tab **Service Tokens**.
   - Klik **Create Service Token** di pojok kanan atas.
3. Konfigurasi Token:
   - **Service Token Name**: `Kalkulator Pajak Kendaraan - Production`
   - **Service Token Duration**: Pilih `1 year` (atau sesuai kebijakan masa berlaku).
   - Klik **Save / Generate token**.
4. **Penanganan Kredensial:**
   - **Client ID**: Salin nilai Client ID (contoh: `abcdef0123456789.access`).
   - **Client Secret**: Salin nilai Client Secret dan simpan ke Secret Manager konsumen. **Jangan simpan atau kirim Client Secret ke repositori kode ini.**
5. Pasang Token ke Access Policy:
   - Buka menu **Access** -> **Applications**.
   - Pilih aplikasi `API Kendaraan BPAD NTT` (`api.uptdpenda-kupang.web.id`).
   - Buka tab **Policies**, pastikan terdapat policy bertipe **Service Auth** yang mengizinkan Service Token `Kalkulator Pajak Kendaraan - Production`.
6. Langkah Finalisasi:
   - Berikan nilai **Client ID** (`<hash>.access`) kepada *API Technical Owner* untuk dimasukkan ke dalam `wrangler.jsonc` (`AUTH_ACCESS_GRANTS_JSON`) dan di-deploy ke Cloudflare Worker.

