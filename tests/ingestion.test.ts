import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import pergub from '../fixtures/canonical/pergub-ntt-26-2025.sample.json';
import permendagri from '../fixtures/canonical/permendagri-11-2026.sample.json';
import { importCanonicalDataset } from '../src/ingestion/importer';
import { loadCanonicalDataset } from '../src/ingestion/load';
import { createEmptyTestDatabase } from './support';

let mf:Miniflare,db:D1Database;
const copy=<T>(value:T):T=>structuredClone(value);
beforeEach(async()=>({mf,db}=await createEmptyTestDatabase()));
afterEach(async()=>{await mf.dispose();});

describe('NJKB canonical ingestion pipeline',()=>{
 it('imports a valid canonical dataset with integer money and a completed manifest',async()=>{
  const report=await importCanonicalDataset(db,pergub,'json');
  expect(report.status).toBe('imported');
  expect(report.summary).toMatchObject({total_records:1,valid_records:1,rejected_records:0,errors:0,inserted_records:1,unchanged_records:0});
  const reference=await db.prepare('SELECT * FROM njkb_references').first<Record<string,unknown>>();
  expect(reference).toMatchObject({tax_year:2025,vehicle_year:2024,source_code:'701167 08549',njkb_rupiah:12500000,
   weight_micros:1000000,dpp_pkb_rupiah:12500000,source_pdf_page:503,source_row:'5310',extraction_method:'manual_transcription'});
  expect((await db.prepare('SELECT status FROM ingestion_manifests').first<{status:string}>())?.status).toBe('completed');
 });

 it('treats importing the exact same dataset twice as already imported',async()=>{
  const first=await importCanonicalDataset(db,pergub,'json');
  const second=await importCanonicalDataset(db,pergub,'json');
  expect(first.status).toBe('imported');expect(second.status).toBe('already_imported');
  expect(second.summary).toMatchObject({inserted_records:0,unchanged_records:1});
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(1);
  expect((await db.prepare('SELECT count(*) AS n FROM ingestion_manifests').first<{n:number}>())?.n).toBe(1);
 });

 it('records a malformed row and preserves it in the rejection report',async()=>{
  const data:any=copy(pergub);data.records=[['broken','row']];
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'malformed_record'})]));
  expect(report.rejected_records[0].raw_record).toEqual(['broken','row']);
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(0);
 });

 it('reports a required field that is missing without silently dropping the row',async()=>{
  const data:any=copy(pergub);delete data.records[0].raw.MERK;
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'missing_value',field:'raw.MERK'})]));
  expect((report.rejected_records[0].raw_record as any).raw).not.toHaveProperty('MERK');
 });

 it('rejects an invalid vehicle year',async()=>{
  const data:any=copy(pergub);data.records[0].raw.TAHUN_BUAT='20X4';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'invalid_year',field:'raw.TAHUN_BUAT'})]));
  expect(report.summary.inserted_records).toBe(0);
 });

 it('rejects malformed monetary text instead of correcting it',async()=>{
  const data:any=copy(pergub);data.records[0].raw.NJKB='12.500,00';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'invalid_monetary_value',field:'raw.NJKB'})]));
  expect(report.summary.inserted_records).toBe(0);
 });

 it('retains document/page/row, raw values, normalized values, method, and review provenance',async()=>{
  const report=await importCanonicalDataset(db,pergub,'json');
  const row=await db.prepare(`SELECT r.raw_values,r.source_pdf_page,r.source_row,r.review_status,r.extraction_method,
   d.sha256,i.normalized_values,i.record_fingerprint FROM njkb_references r
   JOIN source_documents d ON d.id=r.source_document_id JOIN ingestion_records i ON i.reference_id=r.id`).first<any>();
  expect(report.document_sha256).toBe('94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18');
  expect(row).toMatchObject({source_pdf_page:503,source_row:'5310',review_status:'verified',extraction_method:'manual_transcription'});
  expect(JSON.parse(row.raw_values).NJKB).toBe('12.500.000');
  expect(JSON.parse(row.normalized_values)).toMatchObject({brand:'HONDA',njkb_rupiah:12500000,weight_micros:1000000});
  expect(row.record_fingerprint).toMatch(/^[a-f0-9]{64}$/);
 });

 it('is row-idempotent when a new manifest contains the same source evidence',async()=>{
  await importCanonicalDataset(db,pergub,'json');
  const second:any=copy(pergub);second.manifest.dataset_id='pergub-ntt-26-2025-part-a-sample-v2';
  second.manifest.created_at='2026-09-21T00:00:00Z';
  const report=await importCanonicalDataset(db,second,'json');
  expect(report.status).toBe('imported');
  expect(report.summary).toMatchObject({inserted_records:0,unchanged_records:1});
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(1);
  expect((await db.prepare('SELECT count(*) AS n FROM ingestion_manifests').first<{n:number}>())?.n).toBe(2);
 });

 it('reports an inconsistent DPP without replacing the source value',async()=>{
  const data:any=copy(pergub);data.records[0].raw.DP_PKB='12.400.000';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'dpp_mismatch',field:'raw.DP_PKB'})]));
  expect((report.rejected_records[0].raw_record as any).raw.DP_PKB).toBe('12.400.000');
  expect(report.summary.inserted_records).toBe(0);
 });

 it('accepts source-published DPP rounded to nearest rupiah',async()=>{
  const data:any=copy(permendagri);data.records[0].raw.NJKB='321.471.132';data.records[0].raw.BOBOT='1,050';data.records[0].raw.DP_PKB='337.544.689';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('imported');expect(report.summary.errors).toBe(0);
 });

 it('keeps different regulation editions and source codes separate',async()=>{
  const first=await importCanonicalDataset(db,pergub,'json');
  const second=await importCanonicalDataset(db,permendagri,'json');
  expect(first.summary.inserted_records).toBe(1);expect(second.summary.inserted_records).toBe(1);
  const rows=await db.prepare('SELECT tax_year,vehicle_year,source_code,njkb_rupiah FROM njkb_references ORDER BY tax_year').all<any>();
  expect(rows.results).toEqual([
   {tax_year:2025,vehicle_year:2024,source_code:'701167 08549',njkb_rupiah:12500000},
   {tax_year:2026,vehicle_year:2026,source_code:'701167 67749',njkb_rupiah:12900000}
  ]);
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });

 it('detects duplicate normalized identities without fuzzy matching',async()=>{
  const data:any=copy(pergub);const duplicate=copy(data.records[0]);duplicate.source.source_row='5311';duplicate.raw.NO='5311';
  data.records.push(duplicate);
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('imported');
  expect(report.summary).toMatchObject({inserted_records:2,warnings:2,duplicates:2});
  expect(report.issues.every(issue=>issue.code==='duplicate_match_key')).toBe(true);
 });

 it('rejects duplicate document positions as errors',async()=>{
  const data:any=copy(pergub);data.records.push(copy(data.records[0]));
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'duplicate_source_position',severity:'error'})]));
  expect(report.summary.inserted_records).toBe(0);
 });

 it('loads the canonical CSV plus manifest sidecar',async()=>{
  const loaded=await loadCanonicalDataset('fixtures/canonical/pergub-ntt-26-2025.sample.csv');
  const report=await importCanonicalDataset(db,loaded.input,loaded.sourceFormat);
  expect(loaded.sourceFormat).toBe('csv');
  expect(report.status).toBe('imported');
  expect(report.summary.inserted_records).toBe(1);
 });

 it('inserts more than one D1 batch safely',async()=>{
  const data:any=copy(pergub);data.manifest.dataset_id='batch-65';
  data.records=Array.from({length:65},(_,index)=>{
   const row=copy(pergub.records[0]) as any;row.source.source_row=String(6000+index);row.source.pdf_page=504+Math.floor(index/10);
   row.raw.NO=String(6000+index);row.raw.KODING=`701167 ${String(10000+index).padStart(5,'0')}`;return row;
  });
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('imported');expect(report.summary.inserted_records).toBe(65);
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(65);
 });

 it('distinguishes a new document hash and preserves the historical reference',async()=>{
  await importCanonicalDataset(db,pergub,'json');
  const revised:any=copy(pergub);revised.manifest.dataset_id='pergub-revised-document';
  revised.manifest.source_document.id='doc-a-revised';
  revised.manifest.source_document.sha256='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  revised.records[0].source.source_row='5310-revised';revised.records[0].raw.NO='5310-revised';
  const report=await importCanonicalDataset(db,revised,'json');
  expect(report.status).toBe('imported');expect(report.summary.inserted_records).toBe(1);
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'duplicate_existing_match_key',severity:'warning'})]));
  expect((await db.prepare('SELECT count(*) AS n FROM source_documents').first<{n:number}>())?.n).toBe(2);
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(2);
 });

 it('rejects reuse of one document hash under a different source identity',async()=>{
  await importCanonicalDataset(db,pergub,'json');
  const duplicateIdentity:any=copy(pergub);duplicateIdentity.manifest.dataset_id='same-document-another-id';
  duplicateIdentity.manifest.source_document.id='doc-a-copy';
  const report=await importCanonicalDataset(db,duplicateIdentity,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'document_identity_conflict'})]));
  expect((await db.prepare('SELECT count(*) AS n FROM source_documents').first<{n:number}>())?.n).toBe(1);
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(1);
 });

 it('rejects a vehicle year outside the declared edition scope before any D1 write',async()=>{
  const data:any=copy(pergub);data.records[0].raw.TAHUN_BUAT='2026';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'out_of_edition_scope',field:'raw.TAHUN_BUAT'})]));
  expect((await db.prepare('SELECT count(*) AS n FROM njkb_references').first<{n:number}>())?.n).toBe(0);
 });

 it('rejects a Permendagri row outside vehicle_year 2026',async()=>{
  const data:any=copy(permendagri);data.records[0].raw.TAHUN_BUAT='2025';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'out_of_edition_scope'})]));
 });

 it('enforces edition scope for direct database inserts',async()=>{
  await expect(db.prepare(`INSERT INTO njkb_references
   (id,edition_id,regulation_id,source_document_id,tax_year,vehicle_year,section,source_code,source_code_normalized,
    brand,brand_normalized,type,type_normalized,vehicle_category,vehicle_category_normalized,njkb_rupiah,weight_micros,
    dpp_pkb_rupiah,source_pdf_page,source_row,raw_values,normalization_version,review_status,review_note,extraction_method)
   VALUES ('bad','edition-2025','reg-a','doc-a',2025,2026,'A','X','X','B','B','T','T','C','C',1,1000000,1,1,'1','{}','v','verified','bad','pdf_text')`).run()).rejects.toThrow();
 });

 it('rejects numeric source codes so leading zeroes cannot be lost',async()=>{
  const data:any=copy(pergub);data.records[0].raw.KODING=70116708549;
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'malformed_value',field:'raw.KODING'})]));
 });

 it('rejects a mismatch between raw NO and source row provenance',async()=>{
  const data:any=copy(pergub);data.records[0].raw.NO='9999';
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'source_row_mismatch'})]));
 });

 it('rejects conflicting NJKB for the same code, year, and identity',async()=>{
  const data:any=copy(pergub);const conflict=copy(data.records[0]);
  conflict.source.source_row='5311';conflict.raw.NO='5311';conflict.raw.NJKB='12.600.000';conflict.raw.DP_PKB='12.600.000';
  data.records.push(conflict);
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('rejected');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'conflicting_njkb',severity:'error'})]));
 });

 it('flags exact identity shared by different codes without creating a mapping',async()=>{
  const data:any=copy(pergub);const duplicate=copy(data.records[0]);
  duplicate.source.source_row='5311';duplicate.raw.NO='5311';duplicate.raw.KODING='701167 99999';data.records.push(duplicate);
  const report=await importCanonicalDataset(db,data,'json');
  expect(report.status).toBe('imported');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'duplicate_identity',severity:'warning'})]));
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });
});
