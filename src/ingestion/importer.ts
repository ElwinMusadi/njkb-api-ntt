import { importDataset } from '../db/import';
import { hashObject } from './hash';
import { validateCanonicalDataset } from './validation';
import type { CanonicalManifest, ImportReport, ImportSummary, RejectedRecord, SourceFormat,
 ValidatedRecord, ValidationIssue, ValidationResult } from './types';

interface ExistingReference {
 id:string;edition_id:string;regulation_id:string;source_document_id:string;tax_year:number;vehicle_year:number;
 section:string;source_code:string;source_code_normalized:string;brand:string;brand_normalized:string;type:string;
 type_normalized:string;vehicle_category:string;vehicle_category_normalized:string;njkb_rupiah:number;
 weight_micros:number;dpp_pkb_rupiah:number;source_pdf_page:number;source_row:string;raw_values:string;
 review_status:string;review_note:string;extraction_method:string;
}
interface ManifestRow {id:string;status:string;summary_json:string;}
type Cell=string|number|null;

function immutableInsert(db:D1Database,table:string,row:Record<string,Cell>,conflictColumns=['id']) {
 const keys=Object.keys(row),same=keys.filter(key=>!conflictColumns.includes(key)).map(key=>`${table}.${key} IS excluded.${key}`).join(' AND ');
 const target=conflictColumns.join(','),sentinel=conflictColumns[0];
 return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})
  ON CONFLICT(${target}) DO UPDATE SET ${sentinel}=CASE WHEN ${same} THEN ${table}.${sentinel} ELSE NULL END`).bind(...Object.values(row));
}
async function pages<T>(db:D1Database,sql:string,values:unknown[]):Promise<T[]> {
 const rows:T[]=[];let offset=0;
 while(true) {
  const result=await db.prepare(`${sql} LIMIT 500 OFFSET ?`).bind(...values,offset).all<T>();
  rows.push(...result.results);if(result.results.length<500) return rows;offset+=500;
 }
}
function position(record:{section:string;sourcePdfPage:number;sourceRow:string}):string {
 return [record.section,record.sourcePdfPage,record.sourceRow].join('|');
}
function matchKey(record:ValidatedRecord|ExistingReference):string {
 if('normalized' in record) return [record.normalized.source_code,record.normalized.vehicle_year,record.normalized.brand,
  record.normalized.type,record.normalized.vehicle_category].join('|');
 return [record.source_code_normalized,record.vehicle_year,record.brand_normalized,record.type_normalized,
  record.vehicle_category_normalized].join('|');
}
function sameReference(existing:ExistingReference,record:ValidatedRecord,manifest:CanonicalManifest):boolean {
 const value=record.normalized;
 return existing.edition_id===manifest.edition.id&&existing.regulation_id===manifest.regulation.id&&
  existing.source_document_id===manifest.source_document.id&&existing.tax_year===manifest.edition.tax_year&&
  existing.vehicle_year===value.vehicle_year&&existing.section===record.section&&
  existing.source_code_normalized===value.source_code&&existing.brand_normalized===value.brand&&
  existing.type_normalized===value.type&&existing.vehicle_category_normalized===value.vehicle_category&&existing.njkb_rupiah===value.njkb_rupiah&&
  existing.weight_micros===value.weight_micros&&existing.dpp_pkb_rupiah===value.dpp_pkb_rupiah&&
   existing.source_pdf_page===record.sourcePdfPage&&existing.source_row===record.sourceRow&&existing.review_status===record.reviewStatus&&
   existing.review_note===record.reviewNote&&existing.extraction_method===record.extractionMethod&&
   existing.raw_values===JSON.stringify(record.rawValues);

}
function issueFor(record:ValidatedRecord,code:string,message:string,details:Record<string,unknown>):ValidationIssue {
 return {severity:'error',code,message,record_index:record.recordIndex,field:'source',
  source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,details};
}
function report(validation:ValidationResult,status:ImportReport['status'],issues:ValidationIssue[],counts:{inserted:number;unchanged:number;persisted:number},
 extraRejected:RejectedRecord[]=[]):ImportReport {
 const rejected=[...validation.rejectedRecords];
 for(const item of extraRejected) if(!rejected.some(value=>value.record_index===item.record_index)) rejected.push(item);
 const errors=issues.filter(issue=>issue.severity==='error').length,warnings=issues.filter(issue=>issue.severity==='warning').length;
 const summary:ImportSummary={total_records:validation.summary.total_records,
  valid_records:Math.max(0,validation.summary.total_records-rejected.length),rejected_records:rejected.length,errors,warnings,
  duplicates:issues.filter(issue=>issue.code.startsWith('duplicate_')).length,inserted_records:counts.inserted,
  unchanged_records:counts.unchanged,persisted_issues:counts.persisted};
 return {status,manifest_id:validation.manifestId,dataset_id:validation.manifest?.dataset_id??null,
  dataset_sha256:validation.datasetSha256,document_sha256:validation.manifest?.source_document.sha256??null,
  source_format:validation.sourceFormat,summary,issues,rejected_records:rejected.sort((a,b)=>a.record_index-b.record_index)};
}
function rejected(record:ValidatedRecord,code:string):RejectedRecord {
 return {record_index:record.recordIndex,raw_record:{source:{pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
  section:record.section,vehicle_category:record.vehicleCategory},raw:record.rawValues,review:{status:record.reviewStatus,note:record.reviewNote}},
  normalized_values:{...record.normalized},issue_codes:[code]};
}
async function metadataIssues(db:D1Database,manifest:CanonicalManifest):Promise<ValidationIssue[]> {
 const issues:ValidationIssue[]=[];
 const definitions:[string,string,Record<string,unknown>][]=[
  ['regulations',manifest.regulation.id,manifest.regulation],
  ['source_documents',manifest.source_document.id,manifest.source_document],
  ['reference_editions',manifest.edition.id,manifest.edition]
 ];
 for(const [table,id,expected] of definitions) {
  const existing=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<Record<string,unknown>>();
  if(existing) for(const [key,value] of Object.entries(expected)) if(existing[key]!==value) {
   issues.push({severity:'error',code:'existing_metadata_conflict',message:`Existing ${table} metadata differs`,record_index:null,
    field:`manifest.${table}.${key}`,source_pdf_page:null,source_row:null,details:{id,field:key}});break;
  }
 }
 const sameHash=await db.prepare('SELECT id FROM source_documents WHERE regulation_id=? AND sha256=?')
  .bind(manifest.regulation.id,manifest.source_document.sha256).first<{id:string}>();
 if(sameHash&&sameHash.id!==manifest.source_document.id) issues.push({severity:'error',code:'document_identity_conflict',
  message:'This document hash already exists under a different source_document id',record_index:null,
  field:'manifest.source_document.id',source_pdf_page:null,source_row:null,details:{existing_source_document_id:sameHash.id}});
 return issues;
}

export async function importCanonicalDataset(db:D1Database,input:unknown,sourceFormat:SourceFormat):Promise<ImportReport> {
 const validation=await validateCanonicalDataset(input,sourceFormat);
 if(!validation.canImport||!validation.manifest||!validation.manifestId)
  return report(validation,'rejected',validation.issues,{inserted:0,unchanged:0,persisted:0});
 const manifest=validation.manifest,issues=[...validation.issues];
 const existingManifest=await db.prepare('SELECT id,status,summary_json FROM ingestion_manifests WHERE source_document_id=? AND dataset_sha256=?')
  .bind(manifest.source_document.id,validation.datasetSha256).first<ManifestRow>();
 if(existingManifest?.status==='completed') {
  const saved=JSON.parse(existingManifest.summary_json) as ImportSummary;
  const savedIssues=await loadIssues(db,existingManifest.id);
  return {status:'already_imported',manifest_id:existingManifest.id,dataset_id:manifest.dataset_id,
   dataset_sha256:validation.datasetSha256,document_sha256:manifest.source_document.sha256,source_format:sourceFormat,
   summary:{...saved,inserted_records:0,unchanged_records:validation.summary.total_records},issues:savedIssues,rejected_records:[]};
 }
 issues.push(...await metadataIssues(db,manifest));
 const existing=await pages<ExistingReference>(db,'SELECT * FROM njkb_references WHERE edition_id=?',[manifest.edition.id]);
 const byId=new Map(existing.map(value=>[value.id,value]));
 const byPosition=new Map(existing.filter(value=>value.source_document_id===manifest.source_document.id)
  .map(value=>[[value.section,value.source_pdf_page,value.source_row].join('|'),value]));
 const byMatch=new Map<string,ExistingReference[]>();
 for(const value of existing) byMatch.set(matchKey(value),[...(byMatch.get(matchKey(value))??[]),value]);
 const resolved=new Map<number,{reference:ExistingReference|null;id:string;disposition:'inserted'|'unchanged'}>();
 const extraRejected:RejectedRecord[]=[];
 for(const record of validation.records) {
  const found=byId.get(record.id)??byPosition.get(position(record));
  if(found&&!sameReference(found,record,manifest)) {
   issues.push(issueFor(record,'existing_source_conflict','Existing reference at this source identity has different values',{existing_reference_id:found.id}));
   extraRejected.push(rejected(record,'existing_source_conflict'));continue;
  }
  const duplicate=(byMatch.get(matchKey(record))??[]).filter(value=>value.id!==found?.id);
  if(duplicate.length) issues.push({severity:'warning',code:'duplicate_existing_match_key',
   message:'An existing reference shares this normalized matching identity',record_index:record.recordIndex,field:'raw.KODING',
   source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,details:{existing_reference_ids:duplicate.map(value=>value.id)}});
  resolved.set(record.recordIndex,{reference:found??null,id:found?.id??record.id,disposition:found?'unchanged':'inserted'});
 }
 if(issues.some(issue=>issue.severity==='error')) return report(validation,'rejected',issues,{inserted:0,unchanged:0,persisted:0},extraRejected);

 await importDataset(db,{schema_version:1,regulations:[manifest.regulation],source_documents:[manifest.source_document],
  reference_editions:[manifest.edition],njkb_references:[]});
 await db.prepare(`INSERT INTO ingestion_manifests
  (id,dataset_id,schema_version,source_format,dataset_sha256,document_sha256,regulation_id,source_document_id,
   edition_id,tax_year,extraction_method,extraction_tool,extraction_tool_version,source_created_at,status,record_count,summary_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(validation.manifestId,manifest.dataset_id,2,
  sourceFormat,validation.datasetSha256,manifest.source_document.sha256,manifest.regulation.id,manifest.source_document.id,
  manifest.edition.id,manifest.edition.tax_year,manifest.extraction.method,manifest.extraction.tool,manifest.extraction.tool_version,
  manifest.created_at,'importing',validation.summary.total_records,'{}').run();

 for(let start=0;start<validation.records.length;start+=30) {
  const statements:D1PreparedStatement[]=[];
  for(const record of validation.records.slice(start,start+30)) {
   const resolution=resolved.get(record.recordIndex)!;const value=record.normalized;
   if(!resolution.reference) statements.push(db.prepare(`INSERT INTO njkb_references
    (id,edition_id,regulation_id,source_document_id,tax_year,vehicle_year,section,source_code,source_code_normalized,
     brand,brand_normalized,type,type_normalized,vehicle_category,vehicle_category_normalized,njkb_rupiah,weight_micros,
     dpp_pkb_rupiah,source_pdf_page,source_row,raw_values,normalization_version,review_status,review_note,extraction_method)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(record.id,manifest.edition.id,
    manifest.regulation.id,manifest.source_document.id,manifest.edition.tax_year,value.vehicle_year,record.section,
    String(record.rawValues.KODING).trim(),value.source_code,String(record.rawValues.MERK).trim(),value.brand,
    String(record.rawValues.TYPE).trim(),value.type,record.vehicleCategory,value.vehicle_category,value.njkb_rupiah,
    value.weight_micros,value.dpp_pkb_rupiah,record.sourcePdfPage,record.sourceRow,JSON.stringify(record.rawValues),
    'nfkc-upper-whitespace-v1',record.reviewStatus,record.reviewNote,record.extractionMethod));
   statements.push(immutableInsert(db,'ingestion_records',{manifest_id:validation.manifestId,record_index:record.recordIndex,
    reference_id:resolution.id,source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
    record_fingerprint:record.fingerprint,raw_values:JSON.stringify(record.rawValues),
    normalized_values:JSON.stringify(record.normalized),extraction_method:record.extractionMethod,
    review_status:record.reviewStatus,review_note:record.reviewNote,
    disposition:resolution.disposition},['manifest_id','record_index']));
  }
  if(statements.length) await db.batch(statements);
 }
 const warnings=issues.filter(issue=>issue.severity==='warning');
 for(let start=0;start<warnings.length;start+=50) {
  const statements:D1PreparedStatement[]=[];
  for(const issue of warnings.slice(start,start+50)) statements.push(immutableInsert(db,'ingestion_issues',{
   id:`issue:${await hashObject({manifest:validation.manifestId,issue})}`,manifest_id:validation.manifestId,
   record_index:issue.record_index,source_pdf_page:issue.source_pdf_page,source_row:issue.source_row,severity:issue.severity,
   code:issue.code,field:issue.field,message:issue.message,details:JSON.stringify(issue.details)}));
  if(statements.length) await db.batch(statements);
 }
 const dispositions=await db.prepare(`SELECT disposition,count(*) AS count FROM ingestion_records WHERE manifest_id=? GROUP BY disposition`)
  .bind(validation.manifestId).all<{disposition:'inserted'|'unchanged';count:number}>();
 const inserted=dispositions.results.find(value=>value.disposition==='inserted')?.count??0;
 const unchanged=dispositions.results.find(value=>value.disposition==='unchanged')?.count??0;
 const finalReport=report(validation,'imported',issues,{inserted,unchanged,persisted:warnings.length});
 await db.prepare(`UPDATE ingestion_manifests SET status='completed',inserted_count=?,unchanged_count=?,warning_count=?,
  summary_json=?,imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(inserted,unchanged,warnings.length,
  JSON.stringify(finalReport.summary),validation.manifestId).run();
 return finalReport;
}

async function loadIssues(db:D1Database,manifestId:string):Promise<ValidationIssue[]> {
 const rows=await db.prepare(`SELECT severity,code,message,record_index,field,source_pdf_page,source_row,details
  FROM ingestion_issues WHERE manifest_id=? ORDER BY record_index,code`).bind(manifestId).all<Omit<ValidationIssue,'details'>&{details:string}>();
 return rows.results.map(value=>({...value,details:JSON.parse(value.details) as Record<string,unknown>}));
}
