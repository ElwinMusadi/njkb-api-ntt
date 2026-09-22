# Schema D1

SQL authoritative ada di migrations/. Semua tabel memakai SQLite STRICT.

| Tabel | Tujuan dan field pokok |
|---|---|
| regulations | id, jurisdiction, kind, number, regulation_year, title, effective_from/to |
| source_documents | id, regulation_id, filename, source_url nullable, acquisition_method, sha256, page_count |
| reference_editions | id, regulation_id, tax_year, jurisdiction, applicability_status, applicability_note |
| njkb_references | id, edition/regulation/document, tax_year, vehicle_year, section, source_code, brand, type, vehicle_category, normalized counterparts, njkb_rupiah, weight_micros, dpp_pkb_rupiah, page, row, raw JSON, normalization_version, review_status/note |
| vehicle_code_mappings | provider, api_brand_code, api_type_code, edition, vehicle_year, target_source_code, evidence document/page/note, review_status |
| njmkb_references | edition/regulation/document/tax_year, modification_type and normalized, base category and normalized, year_label/min/max/basis, money nullable, cell status, page/row/column, raw JSON, review status |
| match_audits | resolution_as_of, vehicle_year, edition/reference nullable, status, method, minimal snapshot JSON, reasons JSON, legacy requested tax year nullable, timestamp |
| ingestion_manifests | dataset/document hashes, source identity, edition/tax year, extraction metadata, status, counts, report summary |
| ingestion_records | manifest row → NJKB reference, raw/normalized JSON, fingerprint, extraction/review metadata, disposition |
| ingestion_issues | warning/error code, field, source page/row, details, manifest linkage |

Relasi: regulations → documents dan editions; njkb/njmkb → edition + document.
Composite FK mengharuskan source document dan edition berasal dari regulation
yang sama, serta tax_year record sama dengan edisinya. tax_year diduplikasi secara
terkontrol pada record agar ekspor dan query memiliki konteks eksplisit. Field ini
adalah metadata edisi/regulasi, bukan public lookup dimension. Resolver memilih
edisi `approved` yang efektif pada `resolution_as_of`, lalu mencocokkan
`vehicle_year` dan identitas kendaraan.

Uang INTEGER rupiah 0..Number.MAX_SAFE_INTEGER. SQLite STRICT menolak nilai pecahan
nonintegral. Importer menolak pecahan dan angka di luar rentang integer aman JS.
Bobot fixed-point INTEGER skala 1.000.000 (1.025 → 1025000); jangan mengimpor bobot
sebagai float. Importer menerima weight_micros yang sudah diskalakan sebagai integer.
DPP sumber disimpan apa adanya, bukan dihitung atau diperbaiki otomatis.

Normalisasi v1: Unicode NFKC, trim, collapse whitespace, uppercase. Tidak menghapus
spasi kode, nol awal, karakter transmisi atau penanda varian. raw_values JSON
mempertahankan nilai tercetak. Label kategori berasal dari kelompok tabel sumber.

Migration 0003 adds `njkb_references.extraction_method`, a unique source-document
identity index on regulation + SHA-256, and the three ingestion tables. Existing
Phase 1 fixtures receive `legacy_fixture` as extraction method; canonical imports
store the declared extraction method without rewriting legacy raw JSON.

Index non-unique:

```sql
CREATE INDEX idx_njkb_code
 ON njkb_references(edition_id,source_code_normalized,vehicle_year);
CREATE INDEX idx_njkb_identity
 ON njkb_references(edition_id,brand_normalized,type_normalized,
                    vehicle_year,vehicle_category_normalized);
CREATE INDEX idx_njkb_coverage
 ON njkb_references(edition_id,vehicle_year,
                    vehicle_category_normalized,review_status);
CREATE INDEX idx_reference_edition_resolution
 ON reference_editions(applicability_status,jurisdiction);
```

Unique import identity: edition + document + section + page + row. Ini identitas
posisi sumber, bukan klaim keunikan kode. NJMKB menambahkan kolom matriks pada
identitas impor. Satu kode boleh muncul berulang, termasuk kandidat ambigu.

Tidak ada automatic code alias dan tidak ada unique global source_code.
Mapping provider dan kode sumber dibatasi edition + vehicle_year; fixture produksi
belum memiliki mapping. Phase 2 hanya memakai baris dengan review status verified,
setelah exact-code dan exact-identity tidak menemukan kandidat. Tidak ada mapping
yang dibuat otomatis dari kemiripan kode atau nama.

NJMKB mendukung tahun eksplisit/rentang atau konteks regulasi tanpa tahun pada sel.
Sel blank/dash/shaded harus NULL; tidak disamakan dengan uang 0. Bagian NJAB 2026
berupa pedoman, sehingga tidak dimasukkan sebagai data kendaraan.

Trigger memvalidasi batas halaman NJKB/NJMKB saat insert/update serta konteks
reference pada audit insert/update. Migration 0004 mengganti konteks audit publik
lama (`requested_tax_year`) dengan tanggal otoritas internal `resolution_as_of`.
Foreign key menjaga referensi metadata.
Metadata sumber yang dipakai sebaiknya immutable secara proses review. Phase 2
tidak menyediakan endpoint edit administratif maupun public lookup endpoint.

Migration runner Wrangler memakai tabel internal d1_migrations. Test runner memakai
migration SQL yang sama pada DB disposable. Konvensi file migration untuk test:
body trigger ditulis satu baris, pemisah statement adalah semicolon + newline.
