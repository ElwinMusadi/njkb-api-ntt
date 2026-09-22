import { normalize } from '../db/import';
import { hashObject, sha256 } from './hash';
import { canonicalEnvelopeSchema, type RejectedRecord, type SourceFormat, type ValidatedRecord,
 type ValidationIssue, type ValidationResult } from './types';

const RAW_FIELDS=['NO','KODING','MERK','TYPE','TAHUN_BUAT','NJKB','BOBOT','DP_PKB'] as const;
type RawField=typeof RAW_FIELDS[number];
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const rawText=(value:unknown):string|null=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):null;
const integer=(value:unknown):number|null=>{
 if(typeof value==='number') return Number.isSafeInteger(value)?value:null;
 if(typeof value!=='string'||!/^\d+$/.test(value.trim())) return null;
 const result=Number(value.trim());return Number.isSafeInteger(result)?result:null;
};
const money=(value:unknown):number|null=>{
 if(typeof value==='number') return Number.isSafeInteger(value)&&value>=0?value:null;
 if(typeof value!=='string') return null;
 const text=value.trim();
 if(!/^\d+$/.test(text)&&!/^\d{1,3}(?:\.\d{3})+$/.test(text)) return null;
 const result=Number(text.replaceAll('.',''));
 return Number.isSafeInteger(result)&&result>=0?result:null;
};
const micros=(value:unknown):number|null=>{
 if(typeof value==='number') return Number.isSafeInteger(value)&&value>=0&&Number.isSafeInteger(value*1_000_000)?value*1_000_000:null;
 if(typeof value!=='string') return null;
 const match=/^(\d+)(?:[.,](\d{1,6}))?$/.exec(value.trim());if(!match) return null;
 const result=BigInt(match[1])*1_000_000n+BigInt((match[2]??'').padEnd(6,'0'));
 return result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(result):null;
};

export async function validateCanonicalDataset(input:unknown,sourceFormat:SourceFormat):Promise<ValidationResult> {
 const datasetSha256=await hashObject(input);const issues:ValidationIssue[]=[];
 const rawRecords=Array.isArray((input as {records?:unknown})?.records)?(input as {records:unknown[]}).records:[];
 const add=(issue:Omit<ValidationIssue,'details'>&{details?:Record<string,unknown>})=>issues.push({...issue,details:issue.details??{}});
 const envelope=canonicalEnvelopeSchema.safeParse(input);
 if(!envelope.success) {
  for(const problem of envelope.error.issues) add({severity:'error',code:'invalid_dataset_schema',
   message:problem.message,record_index:null,field:problem.path.join('.')||null,source_pdf_page:null,source_row:null});
  return result(null,null,[],issues,rawRecords,new Map(),sourceFormat,datasetSha256);
 }
 const {manifest,records:recordsInput}=envelope.data;
 if(manifest.source_document.regulation_id!==manifest.regulation.id) add({severity:'error',code:'provenance_mismatch',
  message:'source_document.regulation_id does not match regulation.id',record_index:null,field:'manifest.source_document.regulation_id',source_pdf_page:null,source_row:null});
 if(manifest.edition.regulation_id!==manifest.regulation.id) add({severity:'error',code:'provenance_mismatch',
  message:'edition.regulation_id does not match regulation.id',record_index:null,field:'manifest.edition.regulation_id',source_pdf_page:null,source_row:null});
 if(normalize(manifest.edition.jurisdiction)!==normalize(manifest.regulation.jurisdiction)) add({severity:'error',code:'provenance_mismatch',
  message:'edition.jurisdiction does not match regulation.jurisdiction',record_index:null,field:'manifest.edition.jurisdiction',source_pdf_page:null,source_row:null});
 const manifestId=`ingest:${await sha256(`${manifest.source_document.sha256}:${datasetSha256}`)}`;
 const candidates:ValidatedRecord[]=[];const partial=new Map<number,Record<string,unknown>>();

 for(let index=0;index<recordsInput.length;index++) {
  const record=recordsInput[index];const before=issues.length;let page:number|null=null;let sourceRow:string|null=null;
  const rowIssue=(code:string,message:string,field:string|null,details:Record<string,unknown>={})=>
   add({severity:'error',code,message,record_index:index,field,source_pdf_page:page,source_row:sourceRow,details});
  if(!isObject(record)||'__malformed_csv_row' in record) {
   rowIssue('malformed_record',isObject(record)&&typeof record.__error==='string'?record.__error:'Record must be an object',null);
   continue;
  }
  if(!isObject(record.source)||!isObject(record.raw)||!isObject(record.review)) {
   rowIssue('malformed_record','Record must contain source, raw, and review objects',null);continue;
  }
  const source=record.source,raw=record.raw,review=record.review;
  page=integer(source.pdf_page);sourceRow=rawText(source.source_row);
  if(page===null||page<=0) rowIssue('invalid_provenance','pdf_page must be a positive integer','source.pdf_page');
  else if(page>manifest.source_document.page_count) rowIssue('invalid_provenance','pdf_page exceeds source document page_count','source.pdf_page',{page_count:manifest.source_document.page_count});
  if(!sourceRow) rowIssue('missing_value','source_row is required','source.source_row');
  const section=rawText(source.section)??manifest.defaults.section;
  const categoryRaw=rawText(source.vehicle_category)??manifest.defaults.vehicle_category;
  const reviewStatus=rawText(review.status);
  const reviewNote=rawText(review.note);
  if(!reviewStatus||!['pending','verified','rejected'].includes(reviewStatus)) rowIssue('invalid_review_status','review.status is invalid','review.status');
  if(!reviewNote) rowIssue('missing_value','review.note is required','review.note');
  for(const field of RAW_FIELDS) if(!(field in raw)||raw[field]===null||rawText(raw[field])==='')
   rowIssue('missing_value',`${field} is required`,`raw.${field}`);

  const code=rawText(raw.KODING),brand=rawText(raw.MERK),type=rawText(raw.TYPE);
  if(typeof raw.KODING!=='string'||code===null) rowIssue('malformed_value','KODING must be source text so leading zeroes are preserved','raw.KODING');
  if(typeof raw.MERK!=='string'||brand===null) rowIssue('malformed_value','MERK must be source text','raw.MERK');
  if(typeof raw.TYPE!=='string'||type===null) rowIssue('malformed_value','TYPE must be source text','raw.TYPE');
  if(sourceRow&&rawText(raw.NO)!==sourceRow) rowIssue('source_row_mismatch','raw.NO must equal source.source_row','raw.NO',
   {raw_no:rawText(raw.NO),source_row:sourceRow});
  const vehicleYear=integer(raw.TAHUN_BUAT);
  if(vehicleYear===null||vehicleYear<1900||vehicleYear>2200) rowIssue('invalid_year','TAHUN_BUAT must be an integer from 1900 to 2200','raw.TAHUN_BUAT');
  else if(vehicleYear<manifest.edition.vehicle_year_min||vehicleYear>manifest.edition.vehicle_year_max)
   rowIssue('out_of_edition_scope','TAHUN_BUAT is outside the reference edition vehicle-year scope','raw.TAHUN_BUAT',
    {vehicle_year:vehicleYear,vehicle_year_min:manifest.edition.vehicle_year_min,vehicle_year_max:manifest.edition.vehicle_year_max});
  const njkb=money(raw.NJKB);if(njkb===null) rowIssue('invalid_monetary_value','NJKB must be non-negative whole rupiah','raw.NJKB');
  const weight=micros(raw.BOBOT);if(weight===null) rowIssue('invalid_weight','BOBOT must be a non-negative decimal with at most 6 places','raw.BOBOT');
  const dpp=money(raw.DP_PKB);if(dpp===null) rowIssue('invalid_monetary_value','DP_PKB must be non-negative whole rupiah','raw.DP_PKB');
  const normalized:Record<string,unknown>={};
  if(code!==null) normalized.source_code=normalize(code);
  if(brand!==null) normalized.brand=normalize(brand);
  if(type!==null) normalized.type=normalize(type);
  if(vehicleYear!==null) normalized.vehicle_year=vehicleYear;
  normalized.vehicle_category=normalize(categoryRaw);
  if(njkb!==null) normalized.njkb_rupiah=njkb;
  if(weight!==null) normalized.weight_micros=weight;
  if(dpp!==null) normalized.dpp_pkb_rupiah=dpp;
  partial.set(index,normalized);
  if(njkb!==null&&weight!==null&&dpp!==null) {
   const product=BigInt(njkb)*BigInt(weight),scale=1_000_000n;
   const quotient=product/scale,remainder=product%scale,rounded=quotient+(remainder>=scale/2n?1n:0n);
   if(rounded!==BigInt(dpp)) rowIssue('dpp_mismatch','DP_PKB is not equal to NJKB × BOBOT rounded to nearest rupiah','raw.DP_PKB',
    {njkb_rupiah:njkb,weight_micros:weight,expected_dpp_exact:`${product}/${scale}`,expected_dpp_rounded:Number(rounded),actual_dpp_rupiah:dpp});
  }
  if(issues.length!==before||page===null||!sourceRow||code===null||brand===null||type===null||vehicleYear===null||njkb===null||weight===null||dpp===null||!reviewStatus||!reviewNote) continue;
  const id=`njkb:${await sha256([manifest.source_document.sha256,manifest.edition.id,section,page,sourceRow].join('|'))}`;
  const values={source_code:normalize(code),brand:normalize(brand),type:normalize(type),vehicle_year:vehicleYear,
   vehicle_category:normalize(categoryRaw),njkb_rupiah:njkb,weight_micros:weight,dpp_pkb_rupiah:dpp};
  candidates.push({recordIndex:index,id,fingerprint:await hashObject({section,categoryRaw,page,sourceRow,raw,values,review}),section,
   vehicleCategory:categoryRaw,
   sourcePdfPage:page,sourceRow,rawValues:raw,normalized:values,
   reviewStatus:reviewStatus as ValidatedRecord['reviewStatus'],reviewNote,extractionMethod:manifest.extraction.method});
 }

 const invalidIndexes=new Set(issues.filter(issue=>issue.severity==='error'&&issue.record_index!==null).map(issue=>issue.record_index!));
 const positions=new Map<string,ValidatedRecord[]>(),matchKeys=new Map<string,ValidatedRecord[]>(),
  codeKeys=new Map<string,ValidatedRecord[]>(),identityKeys=new Map<string,ValidatedRecord[]>();
 for(const record of candidates) {
  const position=[record.section,record.sourcePdfPage,record.sourceRow].join('|');
  positions.set(position,[...(positions.get(position)??[]),record]);
  const value=record.normalized;
  const key=[value.source_code,value.vehicle_year,value.brand,value.type,value.vehicle_category].join('|');
  matchKeys.set(key,[...(matchKeys.get(key)??[]),record]);
  const codeKey=[value.source_code,value.vehicle_year].join('|');
  codeKeys.set(codeKey,[...(codeKeys.get(codeKey)??[]),record]);
  const identityKey=[value.brand,value.type,value.vehicle_year,value.vehicle_category].join('|');
  identityKeys.set(identityKey,[...(identityKeys.get(identityKey)??[]),record]);
 }
 for(const duplicates of positions.values()) if(duplicates.length>1) for(const record of duplicates) {
  invalidIndexes.add(record.recordIndex);add({severity:'error',code:'duplicate_source_position',message:'Multiple rows use the same document position',
   record_index:record.recordIndex,field:'source',source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
   details:{record_indexes:duplicates.map(value=>value.recordIndex)}});
 }
 for(const duplicates of matchKeys.values()) if(duplicates.length>1) for(const record of duplicates) add({severity:'warning',
  code:'duplicate_match_key',message:'Multiple source rows share the same normalized code and identity',record_index:record.recordIndex,
  field:'raw.KODING',source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
  details:{record_indexes:duplicates.map(value=>value.recordIndex)}});
 for(const duplicates of codeKeys.values()) if(duplicates.length>1) {
  const identities=new Set(duplicates.map(record=>[record.normalized.brand,record.normalized.type,record.normalized.vehicle_category].join('|')));
  const values=new Set(duplicates.map(record=>[record.normalized.njkb_rupiah,record.normalized.weight_micros,record.normalized.dpp_pkb_rupiah].join('|')));
  const code=identities.size>1?'conflicting_code_identity':values.size>1?'conflicting_njkb':null;
  if(code) for(const record of duplicates) {invalidIndexes.add(record.recordIndex);add({severity:'error',code,
   message:code==='conflicting_code_identity'?'The same source code and vehicle year have conflicting identities':'The same source code, vehicle year, and identity have conflicting NJKB values',
   record_index:record.recordIndex,field:'raw.KODING',source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
   details:{record_indexes:duplicates.map(value=>value.recordIndex)}});}
 }
 for(const duplicates of identityKeys.values()) if(duplicates.length>1&&new Set(duplicates.map(record=>record.normalized.source_code)).size>1)
  for(const record of duplicates) add({severity:'warning',code:'duplicate_identity',message:'Different source codes share the same normalized vehicle identity',
   record_index:record.recordIndex,field:'raw.KODING',source_pdf_page:record.sourcePdfPage,source_row:record.sourceRow,
   details:{record_indexes:duplicates.map(value=>value.recordIndex),source_codes:duplicates.map(value=>value.normalized.source_code)}});
 const records=candidates.filter(record=>!invalidIndexes.has(record.recordIndex));
 return result(manifestId,manifest,records,issues,recordsInput,partial,sourceFormat,datasetSha256);
}

function result(manifestId:string|null,manifest:ValidationResult['manifest'],records:ValidatedRecord[],issues:ValidationIssue[],
 rawRecords:unknown[],partial:Map<number,Record<string,unknown>>,sourceFormat:SourceFormat,datasetSha256:string):ValidationResult {
 const rejectedIndexes=[...new Set(issues.filter(issue=>issue.severity==='error'&&issue.record_index!==null).map(issue=>issue.record_index!))].sort((a,b)=>a-b);
 const rejectedRecords:RejectedRecord[]=rejectedIndexes.map(index=>({record_index:index,raw_record:rawRecords[index],
  normalized_values:partial.get(index)??{},issue_codes:[...new Set(issues.filter(issue=>issue.record_index===index&&issue.severity==='error').map(issue=>issue.code))]}));
 const errors=issues.filter(issue=>issue.severity==='error').length,warnings=issues.filter(issue=>issue.severity==='warning').length;
 return {sourceFormat,datasetSha256,manifestId,manifest,records,issues,rejectedRecords,
  summary:{total_records:rawRecords.length,valid_records:records.length,rejected_records:rejectedRecords.length,errors,warnings,
   duplicates:issues.filter(issue=>issue.code.startsWith('duplicate_')).length},canImport:errors===0&&manifest!==null};
}
