# API Change and Versioning Policy

## 1. Current Version

Current production endpoint tetap unversioned:

```text
GET /api/njkb/{nopol}
```

Contract version pada OpenAPI: `1.0.0`. Tidak ada perubahan route ke `/api/v1` karena
itu sendiri akan menjadi breaking change dan tidak diperlukan oleh current consumers.

## 2. Compatibility Principle

Dokumentasi dan tests melindungi actual production behavior. Implementasi tidak boleh
diubah hanya agar mengikuti pola API lain yang dianggap lebih ideal.

Future breaking contract harus diperkenalkan melalui explicit versioned path atau
compatibility period yang disetujui. Existing route tetap tersedia selama deprecation
window.

## 3. Non-Breaking Changes

Contoh:

- menambah optional response field tanpa mengubah existing field;
- menambah dokumentasi, examples, atau description;
- menambah operational endpoint terpisah;
- memperbaiki performance tanpa semantic change;
- internal observability/security hardening tanpa perubahan public body/status;
- menambah new error scenario untuk new optional functionality, tanpa mengubah existing
  behavior.

Penambahan field hanya non-breaking bagi consumers yang mengabaikan unknown fields.
Consumers dilarang memvalidasi response dengan `additionalProperties: false` buatan
sendiri di luar published schema version tanpa compatibility plan.

## 4. Potentially Breaking Changes

Memerlukan contract impact review:

- menambah required request parameter;
- mengubah HTTP status pada existing scenario;
- mengubah error code/message semantics;
- mengubah nullability;
- mengubah matching method name;
- mengubah normalization input behavior;
- mengubah rate-limit behavior/header secara material;
- menambah authentication requirement;
- mengaktifkan CORS dengan policy baru;
- menambah required response field yang harus diproses consumer.

## 5. Breaking Changes

Contoh:

- mengganti atau menghapus `/api/njkb/{nopol}` tanpa compatibility route;
- menghapus/rename required field;
- mengubah `njkb.value`, `weight`, atau `dpp_pkb` dari decimal string ke JSON number;
- mengubah `vehicle.year` type;
- mengubah `matched`, `not_found`, `conflict`, atau public error meaning;
- mengembalikan PII/internal identifier;
- mengubah vehicle-year regulatory semantics atau mengaktifkan cross-year fallback;
- memakai fuzzy match sebagai automatic public result.

## 6. Regulatory and Data Governance

Regulatory update yang mengubah NJKB bukan sekadar API documentation change. Ia harus
melalui regulatory evidence, extraction/validation, canonical dataset governance,
matching/regression, deployment, dan production verification yang terpisah.

Public response dapat tetap compatible ketika underlying approved reference diperbarui,
tetapi change harus dicatat sebagai data/regulatory release.

## 7. Deprecation Policy

Untuk breaking contract yang disetujui:

1. publish new version/path;
2. dokumentasikan migration guide;
3. beri deprecation notice dan sunset date yang realistis;
4. pertahankan existing contract selama window;
5. monitor consumer migration;
6. hapus old version hanya setelah explicit approval.

Tidak ada deprecation aktif saat ini.

## 8. Change Gate

Sebelum merge/deploy public API change:

- update OpenAPI;
- update contract/backward compatibility tests;
- run full suite/build/D1 samples;
- review PII/security impact;
- classify change: non-breaking, potentially breaking, atau breaking;
- untuk breaking change, dapatkan explicit approval dan versioning plan;
- production deploy hanya setelah contract verification.
