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

export function jsonResponse(body:unknown,status=200):Response {
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
