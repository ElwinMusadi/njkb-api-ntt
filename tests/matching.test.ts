import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Miniflare } from 'miniflare';
import fixture from '../fixtures/verified.json';
import { BpadVehicleAdapter } from '../src/bpad/adapter';
import { importDataset } from '../src/db/import';
import { MatchAuditRepository, NjkbRepository } from '../src/db/repository';
import { NjkbMatchingEngine } from '../src/matching/engine';
import { NjkbLookupService } from '../src/matching/service';
import { bpadMobilio2019, bpadPayload, createTestDatabase, jsonResponse, seedMobilio2019 } from './support';

const resolutionAsOf='2026-09-20';
// DH4786PD → HONDA C1M02N42L1 A/T, vehicle_year 2024, code 701167 08549
// DH2026ZZ → HONDA C1M02N42L1 A/T, vehicle_year 2026, code 701167 67749
const bpad2026={...bpadPayload,NOPOL:'DH2026ZZ',KD_TIPE:'701167 67749',TahunPembuatan:2026};
const bpad2025={...bpadPayload,NOPOL:'DH2025AA',TahunPembuatan:2025};
let mf:Miniflare,db:D1Database;
const service=(payload:unknown=bpadPayload,status=200)=>new NjkbLookupService(
 new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(payload,status))}),
 new NjkbMatchingEngine(new NjkbRepository(db),new MatchAuditRepository(db))
);

beforeEach(async()=>({mf,db}=await createTestDatabase()));
afterEach(async()=>{await mf.dispose();});

describe('vehicle category remediation regressions',()=>{
 it('resolves BPAD MINIBUS through canonical MOBIL PENUMPANG by exact code and year',async()=>{
  await seedMobilio2019(db);
  const result=await service(bpadMobilio2019).lookup('DH1823HJ',resolutionAsOf);
  expect(result).toEqual({status:'matched',match_method:'exact_code',njkb:150000000,weight_micros:1050000,dpp_pkb:157500000,
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',document_sha256:'94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18',pdf_page:181,row:'2587',source_code:'103167 40649',reference_id:'fixture-mobilio-2019'}});
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });

 it('performs exact-code lookup before category coverage and preserves genuine category conflict',async()=>{
  await seedMobilio2019(db);
  const result=await service({...bpadMobilio2019,JenisKendaraan:'DOUBLE CABIN'}).lookup('DH1823HJ',resolutionAsOf);
  expect(result).toMatchObject({status:'conflict',method:'exact_code',conflicts:['vehicle_category']});
  expect(result.status).not.toBe('reference_unavailable');
 });

 it('does not use a wrong-year exact code and never falls back across vehicle years',async()=>{
  await seedMobilio2019(db);
  const result=await service({...bpadMobilio2019,TahunPembuatan:2020}).lookup('DH1823HJ',resolutionAsOf);
  expect(result).toMatchObject({status:'reference_unavailable',vehicle_year:2020});
  expect(result).not.toHaveProperty('njkb');
 });

 it('does not convert canonical category normalization into code aliasing',async()=>{
  await seedMobilio2019(db);
  const result=await service({...bpadMobilio2019,KD_TIPE:'UNKNOWN',Type:'UNKNOWN MOBILIO'}).lookup('DH1823HJ',resolutionAsOf);
  expect(result.status).toBe('not_found');
  expect(result).not.toHaveProperty('njkb');
 });
});

describe('NJKB vehicle-year resolution engine — Phase 6',()=>{
 // Test 1: Historical exact code (vehicle_year 2024 → Pergub NTT 26/2025)
 it('Test 1 — resolves vehicle_year 2024 by exact code from Pergub NTT 26/2025',async()=>{
  const result=await service(bpadPayload).lookup('DH4786PD',resolutionAsOf);
  expect(result).toEqual({
   status:'matched',match_method:'exact_code',njkb:12500000,weight_micros:1000000,dpp_pkb:12500000,
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',document_sha256:'94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18',pdf_page:503,row:'5310',source_code:'701167 08549',reference_id:'fixture-a'}
  });
 });

 // Test 2: Historical 2025 (vehicle_year 2025 → Pergub NTT 26/2025, boundary year)
 it('Test 2 — resolves vehicle_year 2025 (boundary year) from Pergub NTT 26/2025',async()=>{
  const result=await service(bpad2025).lookup('DH2025AA',resolutionAsOf);
  expect(result).toEqual({
   status:'matched',match_method:'exact_code',njkb:12600000,weight_micros:1000000,dpp_pkb:12600000,
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',document_sha256:'94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18',pdf_page:503,row:'5311',source_code:'701167 08549',reference_id:'fixture-a2025'}
  });
 });

 // Test 3: Current 2026 exact code (Permendagri 11/2026)
 it('Test 3 — matches vehicle_year 2026 by exact source code from Permendagri 11/2026',async()=>{
  const result=await service(bpad2026).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toEqual({
   status:'matched',match_method:'exact_code',njkb:12900000,weight_micros:1000000,dpp_pkb:12900000,
   source:{regulation:'Permendagri No. 11 Tahun 2026',document_sha256:'7275fd53416f1880b818dfc74b108d53eb3af3ab896fb3cffec2a333c45be638',pdf_page:55,row:'311',source_code:'701167 67749',reference_id:'fixture-b'}
  });
 });

 // Test 4: Cross-year protection — vehicle_year 2024 must NOT use Permendagri 11/2026
 it('Test 4 — vehicle_year 2024 never resolves from Permendagri 11/2026 (national edition)',async()=>{
  const result=await service(bpadPayload).lookup('DH4786PD',resolutionAsOf);
  if(result.status==='matched') {
   expect(result.source.regulation).not.toContain('Permendagri');
   expect(result.source.regulation).toContain('Pergub');
  }
  // Regardless of match status, must not have fetched from the national edition
  const nationalRows=await db.prepare("SELECT r.id FROM njkb_references r WHERE r.edition_id='edition-2026' AND r.vehicle_year=2024").all<{id:string}>();
  expect(nationalRows.results).toHaveLength(0);
 });

 // Test 5: Cross-year protection — vehicle_year 2026 must NOT use Pergub NTT 26/2025
 it('Test 5 — vehicle_year 2026 never resolves from Pergub NTT 26/2025 (provincial edition)',async()=>{
  const result=await service(bpad2026).lookup('DH2026ZZ',resolutionAsOf);
  expect(result.status).toBe('matched');
  if(result.status==='matched') {
   expect(result.source.regulation).toContain('Permendagri');
   expect(result.source.regulation).not.toContain('Pergub');
  }
 });

 // Test 5b: Engine-level boundary — 2026 vehicle with NTT tier only would yield reference_unavailable
 it('Test 5b — regulatory boundary: NTT edition has no vehicle_year 2026 coverage',async()=>{
  const nttRepo=new NjkbRepository(db);
  expect(await nttRepo.hasYearCoverage(['edition-2025'],2026,'SEPEDA MOTOR RODA DUA')).toBe(false);
 });

 // Test 6: No adjacent-year fallback — vehicle_year 2024 with unknown identity → not_found (not cross-year)
 it('Test 6 — unknown identity in vehicle_year 2024 returns not_found, no adjacent-year fallback',async()=>{
  const result=await service({...bpadPayload,Merk:'YAMAHA',KD_MERK:'999',Type:'UNKNOWN_TYPE',KD_TIPE:'UNKNOWN'}).lookup('DH4786PD',resolutionAsOf);
  // The NTT edition has coverage for 2024 (from the 701167 08549 rows), so the
  // engine enters the tier and reports not_found rather than reference_unavailable.
  // The key invariant: no NJKB value from 2022/2023/2025/2026 is returned.
  expect(result.status).toBe('not_found');
  expect(result).not.toHaveProperty('njkb');
 });

 // Test 7: Different code, same identity — exact identity fallback, no persistent alias
 it('Test 7 — different code but matching identity uses exact_identity; no persistent alias created',async()=>{
  const result=await service({...bpad2026,KD_TIPE:'701167 08549'}).lookup('DH2026ZZ',resolutionAsOf);
  // The BPAD code 701167 08549 is not in edition-2026, but identity (brand/type/year/category) matches
  expect(result).toMatchObject({status:'matched',match_method:'exact_identity',source:{source_code:'701167 67749'}});
  // No mapping was created
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });

 // Test 8: Unknown vehicle — edition covers year/category but identity absent → not_found
 it('Test 8 — unknown vehicle in covered year/category returns not_found',async()=>{
  const result=await service({...bpad2026,Merk:'SUZUKI',KD_MERK:'999',Type:'COMPLETELY_UNKNOWN',KD_TIPE:'ZZZZZZ'}).lookup('DH2026ZZ',resolutionAsOf);
  expect(result.status).toBe('not_found');
  expect(result).not.toHaveProperty('njkb');
 });

 // Additional Phase 5 regressions preserved
 it('does not alias 701167 08549 to 701167 67749 — codes remain independent',async()=>{
  const result=await service({...bpad2026,KD_TIPE:'701167 08549'}).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'matched',match_method:'exact_identity',source:{source_code:'701167 67749'}});
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });
 it('falls back to exact normalized identity when the source code is unknown',async()=>{
  const result=await service({...bpad2026,KD_TIPE:'UNKNOWN'}).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'matched',match_method:'exact_identity',njkb:12900000});
 });
 it('returns ambiguous when exact code has multiple verified references',async()=>{
  const data=structuredClone(fixture);
  data.njkb_references=[{...data.njkb_references[4],id:'fixture-b-duplicate',source_row:'312'}];
  await importDataset(db,data);
  const result=await service(bpad2026).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'ambiguous',method:'exact_code'});
  if(result.status==='ambiguous') expect(result.candidates.map(item=>item.reference_id)).toEqual(['fixture-b','fixture-b-duplicate']);
 });
 it('returns conflict when an exact code contradicts vehicle identity',async()=>{
  await db.prepare("UPDATE njkb_references SET brand='YAMAHA',brand_normalized='YAMAHA' WHERE id='fixture-b'").run();
  const result=await service(bpad2026).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'conflict',method:'exact_code',conflicts:['brand']});
  expect(result).not.toHaveProperty('njkb');
 });
 it('uses only an explicitly verified crosswalk after code and identity miss',async()=>{
  await db.prepare(`INSERT INTO vehicle_code_mappings
   (id,provider,api_brand_code,api_type_code,edition_id,target_source_code,vehicle_year,evidence_document_id,evidence_pdf_page,evidence_note,review_status)
   VALUES ('map-1','BPAD_NTT','167','BPAD-ALIAS','edition-2026','701167 67749',2026,'doc-b',55,'Verified test crosswalk','verified')`).run();
  const result=await service({...bpad2026,Type:'C1M02N42L1 ALIAS',KD_TIPE:'BPAD-ALIAS'}).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'matched',match_method:'verified_code_mapping',njkb:12900000});
 });
 it('exposes fuzzy matches only as review candidates, without NJKB',async()=>{
  const result=await service({...bpad2026,Type:'C1M02N42L1 ATX',KD_TIPE:'UNKNOWN'}).lookup('DH2026ZZ',resolutionAsOf);
  expect(result).toMatchObject({status:'not_found'});
  expect(result).not.toHaveProperty('njkb');
  if(result.status==='not_found') expect(result.review_candidates[0]).toMatchObject({reference_id:'fixture-b'});
 });
 it('preserves BPAD failure as upstream_error and does not write a match audit',async()=>{
  const result=await service({message:'unavailable'},503).lookup('DH4786PD',resolutionAsOf);
  expect(result).toEqual({status:'upstream_error',error:'http_error',http_status:503});
  expect((await db.prepare('SELECT count(*) AS n FROM match_audits').first<{n:number}>())?.n).toBe(0);
 });
 it('stores resolution date and only minimum normalized vehicle fields in audits',async()=>{
  const result=await service(bpad2026).lookup('DH2026ZZ',resolutionAsOf);
  expect(result.status).toBe('matched');
  const row=await db.prepare('SELECT resolution_as_of,minimal_vehicle_snapshot FROM match_audits').first<{resolution_as_of:string;minimal_vehicle_snapshot:string}>();
  expect(row?.resolution_as_of).toBe(resolutionAsOf);
  const snapshot=JSON.parse(row!.minimal_vehicle_snapshot);
  expect(Object.keys(snapshot).sort()).toEqual(['brand','brand_code','type','type_code','vehicle_category','vehicle_year']);
  expect(JSON.stringify(snapshot)).not.toMatch(/DH2026ZZ|PRIVATE/);
 });

 // Phase 6 boundary: vehicle_year 2022 and 2023 also resolve from Pergub
 it('resolves vehicle_year 2022 from Pergub NTT 26/2025',async()=>{
  const result=await service({...bpadPayload,TahunPembuatan:2022}).lookup('DH4786PD',resolutionAsOf);
  expect(result).toMatchObject({status:'matched',match_method:'exact_code',njkb:11700000});
  if(result.status==='matched') expect(result.source.regulation).toContain('Pergub');
 });
 it('resolves vehicle_year 2023 from Pergub NTT 26/2025',async()=>{
  const result=await service({...bpadPayload,TahunPembuatan:2023}).lookup('DH4786PD',resolutionAsOf);
  expect(result).toMatchObject({status:'matched',match_method:'exact_code',njkb:11900000});
  if(result.status==='matched') expect(result.source.regulation).toContain('Pergub');
 });
});
