import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import fixture from '../fixtures/verified.json';
import { importDataset } from '../src/db/import';

export async function createEmptyTestDatabase():Promise<{mf:Miniflare;db:D1Database}> {
 const mf=new Miniflare({
  modules:true,
  script:'export default {fetch(){return new Response(null,{status:404})}}',
  compatibilityDate:'2026-06-11',d1Databases:['NJKB_DB']
 });
 const db=await mf.getD1Database('NJKB_DB') as unknown as D1Database;
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=await readFile(`migrations/${file}`,'utf8');
  const statements=sql.trim().split(/;\s*\n/).map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
 }
 return {mf,db};
}

export async function createTestDatabase():Promise<{mf:Miniflare;db:D1Database}> {
 const result=await createEmptyTestDatabase();
 await importDataset(result.db,fixture);
 return result;
}

export const bpadPayload={
 NOPOL:'DH4786PD',JenisKendaraan:'SEPEDA MOTOR',Merk:'HONDA',KD_MERK:'167',
 Type:'C1M02N42L1 A/T',KD_TIPE:'701167 08549',TahunPembuatan:2024,
 NamaPemilik:'PRIVATE',Alamat:'PRIVATE',NoRangka:'PRIVATE',NoMesin:'PRIVATE',NoKTP:'PRIVATE',NomorTelepon:'PRIVATE'
};
export const bpadMobilio2019={
 NOPOL:'DH1823HJ',JenisKendaraan:'MINIBUS',Merk:'HONDA',KD_MERK:'167',
 Type:'HONDA MOBILIO DD4 1.5 S MT CKD',KD_TIPE:'103167 40649',TahunPembuatan:2019,
 NamaPemilik:'PRIVATE',Alamat:'PRIVATE',NoRangka:'PRIVATE',NoMesin:'PRIVATE',NoKTP:'PRIVATE',NomorTelepon:'PRIVATE'
};
export async function seedMobilio2019(db:D1Database):Promise<void> {
 await db.prepare(`INSERT INTO njkb_references
  (id,edition_id,regulation_id,source_document_id,tax_year,vehicle_year,section,source_code,source_code_normalized,
   brand,brand_normalized,type,type_normalized,vehicle_category,vehicle_category_normalized,njkb_rupiah,weight_micros,
   dpp_pkb_rupiah,source_pdf_page,source_row,raw_values,normalization_version,review_status,review_note,extraction_method)
  VALUES ('fixture-mobilio-2019','edition-2025','reg-a','doc-a',2025,2019,'A.3','103167 40649','103167 40649',
   'HONDA','HONDA','HONDA MOBILIO DD4 1.5 S MT CKD','HONDA MOBILIO DD4 1.5 S MT CKD','MOBIL PENUMPANG','MOBIL PENUMPANG',
   150000000,1050000,157500000,181,'2587','{"NO":"2587","KODING":"103167 40649","MERK":"HONDA","TYPE":"HONDA MOBILIO DD4 1.5 S MT CKD","TAHUN_BUAT":"2019","NJKB":"150.000.000","BOBOT":"1,05","DP_PKB":"157.500.000"}',
   'nfkc-upper-whitespace-v1','verified','Test-only source-backed regression fixture.','manual_transcription')`).run();
}


export function jsonResponse(body:unknown,status=200):Response {
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
