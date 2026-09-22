import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import fixture from '../fixtures/verified.json';
import { importDataset, normalize } from '../src/db/import';
import { NjkbRepository } from '../src/db/repository';
let mf:Miniflare,db:D1Database,repo:NjkbRepository;
const copy=()=>structuredClone(fixture);
beforeEach(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response(null,{status:404})}}',compatibilityDate:'2026-06-11',d1Databases:['NJKB_DB']});
 db=await mf.getD1Database('NJKB_DB') as unknown as D1Database;
 for (const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  const sql=await readFile(`migrations/${file}`,'utf8');
  // Migration convention: one-line trigger bodies; semicolon-newline ends a statement.
  const statements=sql.trim().split(/;\s*\n/).map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
 }
 await importDataset(db,fixture);repo=new NjkbRepository(db);
});
afterEach(async()=>{await mf?.dispose()});
describe('real local D1 reference database',()=>{
 // --- Phase 6: edition applicability ---
 it('edition-2025 (Pergub NTT 26/2025) is approved for vehicle_year <= 2025',async()=>{
  const editions=await repo.approvedEditions('NTT','2026-09-20');
  expect(editions.map(e=>e.id)).toContain('edition-2025');
  expect(editions[0].applicability_status).toBe('approved');
 });
 it('edition-2026 (Permendagri 11/2026) is approved for vehicle_year = 2026',async()=>{
  const editions=await repo.approvedEditions('ID','2026-09-20');
  expect(editions.map(e=>e.id)).toContain('edition-2026');
  expect(editions[0].applicability_status).toBe('approved');
 });
 it('resolves approved editions by authority date, not a client tax year',async()=>{
  expect((await repo.approvedEditions('NTT','2026-09-20')).map(x=>x.id)).toEqual(['edition-2025']);
  expect((await repo.approvedEditions('ID','2026-09-20')).map(x=>x.id)).toEqual(['edition-2026']);
 });

 // --- Phase 6: vehicle_year fixtures ---
 it('retains fixture-a (2024) with correct provenance',async()=>{
  const [r]=await repo.byCode('edition-2025','701167 08549',2024);
  expect(r).toMatchObject({id:'fixture-a',tax_year:2025,vehicle_year:2024,njkb_rupiah:12500000,weight_micros:1000000,dpp_pkb_rupiah:12500000,source_pdf_page:503,source_row:'5310',regulation_id:'reg-a',source_document_id:'doc-a'});
  expect(JSON.parse(r.raw_values).KODING).toBe('701167 08549');
 });
 it('retains fixture-a2022 (2022) from Pergub',async()=>{
  const [r]=await repo.byCode('edition-2025','701167 08549',2022);
  expect(r).toMatchObject({id:'fixture-a2022',tax_year:2025,vehicle_year:2022,njkb_rupiah:11700000,source_pdf_page:503,source_row:'5308'});
 });
 it('retains fixture-a2023 (2023) from Pergub',async()=>{
  const [r]=await repo.byCode('edition-2025','701167 08549',2023);
  expect(r).toMatchObject({id:'fixture-a2023',tax_year:2025,vehicle_year:2023,njkb_rupiah:11900000,source_pdf_page:503,source_row:'5309'});
 });
 it('retains fixture-a2025 (2025) from Pergub — boundary year',async()=>{
  const [r]=await repo.byCode('edition-2025','701167 08549',2025);
  expect(r).toMatchObject({id:'fixture-a2025',tax_year:2025,vehicle_year:2025,njkb_rupiah:12600000,source_pdf_page:503,source_row:'5311'});
 });
 it('retains fixture-b (2026) from Permendagri',async()=>{
  const [r]=await repo.byCode('edition-2026','701167 67749',2026);
  expect(r).toMatchObject({id:'fixture-b',tax_year:2026,vehicle_year:2026,njkb_rupiah:12900000,source_pdf_page:55,source_row:'311'});
 });

 // --- Regulatory boundary: no cross-year, no cross-edition leakage ---
 it('does not find 2026 value in the NTT Pergub edition',async()=>{
  expect(await repo.byCode('edition-2025','701167 08549',2026)).toEqual([]);
  expect(await repo.byIdentity('edition-2025','HONDA','C1M02N42L1 A/T',2026,'SEPEDA MOTOR RODA DUA')).toEqual([]);
 });
 it('does not find pre-2026 values in the Permendagri edition',async()=>{
  expect(await repo.byCode('edition-2026','701167 67749',2024)).toEqual([]);
  expect(await repo.byCode('edition-2026','701167 67749',2025)).toEqual([]);
  expect(await repo.byIdentity('edition-2026','HONDA','C1M02N42L1 A/T',2024,'SEPEDA MOTOR RODA DUA')).toEqual([]);
  expect(await repo.byIdentity('edition-2026','HONDA','C1M02N42L1 A/T',2025,'SEPEDA MOTOR RODA DUA')).toEqual([]);
 });
 it('does not alias 701167 08549 into the Permendagri edition',async()=>{
  expect(await repo.byCode('edition-2026','701167 08549',2026)).toEqual([]);
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });
 it('does not alias 701167 67749 into the Pergub edition',async()=>{
  expect(await repo.byCode('edition-2025','701167 67749',2024)).toEqual([]);
  expect(await repo.byCode('edition-2025','701167 67749',2025)).toEqual([]);
 });

 // --- hasYearCoverage boundary ---
 it('hasYearCoverage: NTT edition covers vehicle_year 2022–2025 but not 2026',async()=>{
  expect(await repo.hasYearCoverage(['edition-2025'],2022,'SEPEDA MOTOR RODA DUA')).toBe(true);
  expect(await repo.hasYearCoverage(['edition-2025'],2023,'SEPEDA MOTOR RODA DUA')).toBe(true);
  expect(await repo.hasYearCoverage(['edition-2025'],2024,'SEPEDA MOTOR RODA DUA')).toBe(true);
  expect(await repo.hasYearCoverage(['edition-2025'],2025,'SEPEDA MOTOR RODA DUA')).toBe(true);
  expect(await repo.hasYearCoverage(['edition-2025'],2026,'SEPEDA MOTOR RODA DUA')).toBe(false);
 });
 it('hasYearCoverage: national edition covers vehicle_year 2026 but not pre-2026',async()=>{
  expect(await repo.hasYearCoverage(['edition-2026'],2026,'SEPEDA MOTOR RODA DUA')).toBe(true);
  expect(await repo.hasYearCoverage(['edition-2026'],2025,'SEPEDA MOTOR RODA DUA')).toBe(false);
  expect(await repo.hasYearCoverage(['edition-2026'],2024,'SEPEDA MOTOR RODA DUA')).toBe(false);
 });

 // --- Normalization ---
 it('normalizes whitespace/case but preserves variant and leading zero',async()=>{
  expect((await repo.byIdentity('edition-2025',' honda ',' c1m02n42l1   a/t ',2024,'sepeda motor roda dua'))[0].id).toBe('fixture-a');
  expect(await repo.byIdentity('edition-2025','HONDA','C1M02N42L0 A/T',2024,'SEPEDA MOTOR RODA DUA')).toEqual([]);
  expect(normalize('701167 08549')).toBe('701167 08549');
 });

 // --- Idempotency ---
 it('retries identical seed without duplicating rows',async()=>{
  await importDataset(db,fixture);
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(5);
 });

 // --- Integrity ---
 it('rejects changed evidence under the same ID atomically',async()=>{
  const d=copy();d.njkb_references[4].njkb_rupiah=1;
  await expect(importDataset(db,d)).rejects.toThrow();
  expect((await repo.byCode('edition-2026','701167 67749',2026))[0].njkb_rupiah).toBe(12900000);
 });
 it('enforces document/regulation provenance',async()=>{
  const d=copy();d.njkb_references[0].id='bad';d.njkb_references[0].source_document_id='doc-b';
  await expect(importDataset(db,d)).rejects.toThrow();
 });
 it('enforces edition tax year',async()=>{
  const d=copy();d.njkb_references[0].id='bad';d.njkb_references[0].tax_year=2026;
  await expect(importDataset(db,d)).rejects.toThrow();
 });
 it('rejects fractional rupiah in importer and database',async()=>{
  const d=copy();d.njkb_references[0].njkb_rupiah=1.5;
  await expect(importDataset(db,d)).rejects.toThrow();
  await expect(db.prepare("UPDATE njkb_references SET njkb_rupiah=1.5 WHERE id='fixture-a'").run()).rejects.toThrow();
 });
 it('rejects unsafe JavaScript integer amounts',async()=>{
  const d=copy();d.njkb_references[0].njkb_rupiah=Number.MAX_SAFE_INTEGER+1;
  await expect(importDataset(db,d)).rejects.toThrow();
 });
 it('rejects out-of-range provenance page',async()=>{
  await expect(db.prepare("UPDATE njkb_references SET source_pdf_page=691 WHERE id='fixture-a'").run()).rejects.toThrow();
 });
 it('keeps ambiguous candidates instead of enforcing code uniqueness',async()=>{
  const d=copy();d.njkb_references=[{...d.njkb_references[2],id:'another',source_row:'5312'}];
  await importDataset(db,d);
  expect(await repo.byCode('edition-2025','701167 08549',2024)).toHaveLength(2);
 });
 it('excludes pending records from verified candidate lookups',async()=>{
  await db.prepare("UPDATE njkb_references SET review_status='pending' WHERE id='fixture-a'").run();
  expect(await repo.byCode('edition-2025','701167 08549',2024)).toEqual([]);
 });
 it('has all required lookup indexes including Phase 5 additions',async()=>{
  const r=await db.prepare("PRAGMA index_list('njkb_references')").all<{name:string}>();
  expect(r.results.map(x=>x.name)).toEqual(expect.arrayContaining(['idx_njkb_code','idx_njkb_identity','idx_njkb_coverage']));
 });
 it('rolls back an import bundle if a later record fails',async()=>{
  const d=copy();d.njkb_references=[{...d.njkb_references[2],id:'new-good',source_row:'999'},{...d.njkb_references[4],id:'new-bad',source_pdf_page:999}];
  await expect(importDataset(db,d)).rejects.toThrow();
  expect(await db.prepare("SELECT id FROM njkb_references WHERE id='new-good'").first()).toBeNull();
 });
 it('cannot record a matched audit against the wrong vehicle year',async()=>{
  await expect(db.prepare("INSERT INTO match_audits(id,resolution_as_of,vehicle_year,edition_id,reference_id,status,method,minimal_vehicle_snapshot,reasons) VALUES ('a','2026-09-20',2024,'edition-2026','fixture-b','matched','test','{}','[]')").run()).rejects.toThrow();
 });
 it('requires provenance and rejects invalid JSON',async()=>{
  await expect(db.prepare("UPDATE njkb_references SET raw_values='broken' WHERE id='fixture-a'").run()).rejects.toThrow();
  await expect(db.prepare("DELETE FROM source_documents WHERE id='doc-a'").run()).rejects.toThrow();
 });
});
