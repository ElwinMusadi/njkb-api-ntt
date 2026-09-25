# Private API Operational Governance & Production Configuration

Dokumen ini menetapkan panduan operasional harian, tata kelola konfigurasi produksi, verifikasi *drift*, tata kelola pembatasan laju (*rate limiting*), manajemen rollback, dan status konsumen canary untuk Private API NJKB NTT (`GET /api/v1/vehicle/{nopol}`).

---

## 1. Status Produksi Aktif

- **Worker Name:** `njkb-api-ntt`
- **Domain Kustom Produksi:** `https://api.uptdpenda-kupang.web.id/`
- **Versi Worker Aktif Saat Ini:** `69cb7cf7-db68-42e2-92f9-e26aef880462`
- **Target Rollback Sebelumnya (Previous Worker Target):** `15a3a15f-a38c-4ed1-b838-a5e3f1569fd4`
- **Target Rollback Bersih (Known-Clean Rollback Target):** `45f16da5-a1d7-46ef-9f1a-8d21679fde7e`
- **Commit Sumber Produksi Terakhir:** `ba606b6b53ae60668720628f5a39ddc9eea86e48`
- **Database D1 Produksi:** `njkb-api-production` (ID: `ae3097b9-d76d-430f-b5c5-7653c8242b52`)
- **Status Autentikasi:** **ACTIVE** (Cloudflare Access Service-to-Service terverifikasi).

---

## 2. Pemeriksaan Drift Konfigurasi Produksi (Production Configuration Drift Check)

Secara berkala, operator wajib memverifikasi bahwa konfigurasi environment produksi pada Worker Cloudflare tidak mengalami pergeseran (*configuration drift*) dari baseline yang disetujui:

| Variabel Lingkungan Produksi | Nilai Baseline yang Disetujui | Verifikasi Terakhir | Status Drift |
|---|---|---|---|
| `AUTH_ISSUER` | `https://shy-thunder-ffc9.cloudflareaccess.com` | `https://shy-thunder-ffc9.cloudflareaccess.com` | **NO DRIFT** (Identik) |
| `AUTH_AUDIENCE` | `927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa` | `927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa` | **NO DRIFT** (Identik) |
| `AUTH_JWKS_URL` | `https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs` | `https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs` | **NO DRIFT** (Identik) |
| `AUTH_CLOCK_TOLERANCE_SECONDS` | `30` | `30` | **NO DRIFT** (Identik) |
| `AUTH_ACCESS_GRANTS_JSON` | Dual grant (`njkb-api-canary` + `kalkulator-pajak-kendaraan`) | `[{"access_common_name":"d6bb9db60e9cd5ee91327eed387cf2fb.access","principal":"njkb-api-canary","scopes":["vehicle:read","njkb:read"]},{"access_common_name":"258c62aadaa1dad3ca33f871d8439a88.access","principal":"kalkulator-pajak-kendaraan","scopes":["vehicle:read","registration:read","owner:read","tax:read","njkb:read"]}]` | **NO DRIFT** (Identik) |
| `BPAD_TIMEOUT_MS` | `5000` | `5000` | **NO DRIFT** (Identik) |
| `NJKB_RESOLUTION_AS_OF` | `2026-09-20` | `2026-09-20` | **NO DRIFT** (Identik) |

*Prosedur jika terdeteksi drift:* Jika terdapat variabel yang berubah tanpa tiket perubahan rilis yang disetujui, segera laporkan ke *Security Owner* dan lakukan penyelarasan ulang menggunakan `wrangler deploy --env production`.

---

## 3. Status Khusus Konsumen Canary (`njkb-api-canary`)

Token dan entri grant yang saat ini aktif:
- **Nama Service Token:** `njkb-api-canary`
- **Access common_name:** `d6bb9db60e9cd5ee91327eed387cf2fb.access`
- **Principal:** `njkb-api-canary`
- **Scope yang Diberikan:** `vehicle:read`, `njkb:read`
- **Klasifikasi:** **SYSTEM CANARY / SMOKE TEST CONSUMER ONLY**

### Aturan Perlindungan Khusus
1. Kredensial canary hanya boleh digunakan oleh skrip audit internal, pemantauan otomatis kesehatan sistem, atau verifikasi rilis.
2. Dilarang keras membagikan kredensial canary kepada sistem bisnis atau pihak ketiga.
3. Hak akses canary dibatasi secara permanen pada `vehicle:read` dan `njkb:read` (tidak memiliki akses data pemilik, registrasi, maupun raw payload).

---

## 4. Tata Kelola Pembatasan Laju (Rate Limiting Governance)

### Kebijakan Aktif Saat Ini
- **Batas Ambang (*Threshold*):** 60 request per 60 detik.
- **Kunci Identitas (*Key Strategy*):** Berbasis principal terverifikasi (`principal:<project-principal>`).
- **Cakupan Pembatasan (*Limiter Scope*):** Bersifat in-memory per Worker isolate (fixed-window counter).
- **Titik Penegakan:** Dieksekusi setelah autentikasi dan otorisasi berhasil, **sebelum** panggilan upstream ke BPAD NTT.
- **Respons Pelanggaran:** HTTP 429 `rate_limit_exceeded` dengan header `Retry-After`.

### Status Skalabilitas Produksi
- Status saat ini: **PRODUCTION RATE LIMIT POLICY PENDING (Taraf Operasional Awal)**.
- Nilai 60 req/menit per isolate adalah pengaman dasar aplikasi (*application safeguard*) untuk mencegah *runaway loop* dari satu konsumen.
- Penyesuaian batas ambang di masa depan untuk konsumen institusional bervolume tinggi wajib melalui evaluasi kapasitas upstream BPAD NTT dan disetujui oleh *API Technical Owner*.

---

## 5. Prosedur Rollback Cepat (Worker-Only Rollback)

Jika terdeteksi kegagalan operasional pada rilis Private API:

1. **Titik Rollback Terverifikasi:**
   - Versi Target: `45f16da5-a1d7-46ef-9f1a-8d21679fde7e` (Versi sebelum aktivasi auth private route).
2. **Perintah Rollback:**
   ```bash
   npx wrangler rollback 45f16da5-a1d7-46ef-9f1a-8d21679fde7e --env production --message "Emergency rollback private auth"
   ```
3. **Integritas Database D1:**
   - Operasi rollback Worker **sama sekali tidak menyentuh database D1**.
   - Skema D1 dan data NJKB tetap utuh dan aman.
4. **Verifikasi Pasca-Rollback:**
   - Jalankan `curl -I https://api.uptdpenda-kupang.web.id/api/njkb/DH4786PD` (Wajib HTTP 200).
   - Jalankan `curl -I https://api.uptdpenda-kupang.web.id/api/v1/vehicle/DH4786PD` (Wajib HTTP 404 dari Worker setelah melewati Access).

---

## 6. Prosedur Tanggap Insiden Keamanan (Security Incident Response)

```text
1. Identifikasi Insiden (Laporan kebocoran kredensial / akses anomali)
       ↓
2. Isolasi Edge (Nonaktifkan Service Token di Cloudflare Access)
       ↓
3. Verifikasi Blokir Edge (Request menerima HTTP 401)
       ↓
4. Bersihkan Konfigurasi Worker (Hapus entri dari AUTH_ACCESS_GRANTS_JSON)
       ↓
5. Deploy Worker Bersih
       ↓
6. Analisis Forensik Log & Audit Dampak
```

- **Waktu Tanggap:** Kurang dari 15 menit untuk penonaktifan token di Cloudflare Access dashboard.
- **Eskalasi:** Segera hubungi *Incident Escalation Owner* dan *Security Owner*.
