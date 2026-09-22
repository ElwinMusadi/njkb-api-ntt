import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import { NjkbRepository } from '../src/db/repository';
import { NjkbMatchingEngine } from '../src/matching/engine';
import { normalize } from '../src/db/import';

interface CanonicalRecord {
 source:{pdf_page:number;source_row:string;section:string;vehicle_category:string};
 raw:{NO:string;KODING:string;MERK:string;TYPE:string;TAHUN_BUAT:string|number;NJKB:string;BOBOT:string;DP_PKB:string};
}
interface Dataset {manifest:{edition:{id:string};source_document:{sha256:string};regulation:{title:string}};records:CanonicalRecord[];}
const args=process.argv.slice(2);const outputIndex=args.indexOf('--output');
const output=outputIndex>=0?args[outputIndex+1]:'docs/evidence/phase7b-random-sample-qa.json';
const paths=args.filter((value,index)=>index!==outputIndex&&index!==outputIndex+1);
if(paths.length!==2) throw new Error('Usage: ... <pergub.json> <permendagri.json> [--output report.json]');
const datasets=await Promise.all(paths.map(async path=>({path,data:JSON.parse(await readFile(path,'utf8')) as Dataset})));
const stableScore=(record:CanonicalRecord)=>createHash('sha256').update([record.source.section,record.source.pdf_page,record.source.source_row,record.raw.KODING,record.raw.TAHUN_BUAT].join('|')).digest('hex');
const platform=await getPlatformProxy<{NJKB_DB:D1Database}>({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'}});
try {
 const repository=new NjkbRepository(platform.env.NJKB_DB);const engine=new NjkbMatchingEngine(repository);const editions=[];const failures:string[]=[];
 for(const {path,data} of datasets) {
  const groups=new Map<string,number>();for(const record of data.records){const key=`${normalize(record.raw.KODING)}|${record.raw.TAHUN_BUAT}`;groups.set(key,(groups.get(key)??0)+1);}
  const sample=data.records.filter(record=>groups.get(`${normalize(record.raw.KODING)}|${record.raw.TAHUN_BUAT}`)===1)
   .sort((a,b)=>stableScore(a).localeCompare(stableScore(b))).slice(0,20);
  if(sample.length!==20) failures.push(`${data.manifest.edition.id}: only ${sample.length} unique-code samples`);
  const results=[];
  for(const record of sample) {
   const vehicleYear=Number(record.raw.TAHUN_BUAT);
   const result=await engine.match({vehicleCategory:normalize(record.source.vehicle_category),brand:normalize(record.raw.MERK),brandCode:'QA',
    type:normalize(record.raw.TYPE),typeCode:normalize(record.raw.KODING),vehicleYear},'2026-09-20');
   const pass=result.status==='matched'&&result.match_method==='exact_code'&&result.source.document_sha256===data.manifest.source_document.sha256&&
    result.source.pdf_page===record.source.pdf_page&&result.source.row===record.source.source_row;
   if(!pass) failures.push(`${data.manifest.edition.id}:${record.source.pdf_page}/${record.source.source_row}:${result.status}`);
   results.push({source_code:record.raw.KODING,brand:record.raw.MERK,type:record.raw.TYPE,vehicle_year:vehicleYear,njkb:record.raw.NJKB,
    vehicle_category:record.source.vehicle_category,source_page:record.source.pdf_page,source_row:record.source.source_row,
    edition:data.manifest.edition.id,matching_result:result.status,matching_method:result.status==='matched'?result.match_method:null,pass});
  }
  editions.push({dataset:path,edition_id:data.manifest.edition.id,sampling:'lowest SHA-256 scores among unique normalized code/year records',sample_size:sample.length,results});
 }
 const report={schema_version:1,status:failures.length?'FAIL':'PASS',failures,editions};
 await writeFile(output,`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify({status:report.status,output,failures,samples:editions.map(value=>({edition_id:value.edition_id,count:value.sample_size}))}));
 if(failures.length) process.exitCode=2;
} finally {await platform.dispose();}
