import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { ProductionExportManifest } from './export-production-sql';

function run(args:string[]):Promise<string> {
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),...args],{stdio:['ignore','pipe','pipe'],shell:false});let output='',error='';
  child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>error+=String(data));
  child.on('close',code=>code===0?resolvePromise(output):reject(new Error(error||output||`wrangler exited ${code}`)));
 });
}

const manifest=JSON.parse(await readFile('artifacts/production/manifest.json','utf8')) as ProductionExportManifest;
const state=await mkdtemp(join(tmpdir(),'njkb-production-sql-'));
try {
 await run(['d1','migrations','apply','NJKB_DB','--local',`--persist-to=${state}`]);
 for(let pass=1;pass<=2;pass++) {
  const started=Date.now();
  for(let index=0;index<manifest.execution_order.length;index++) {
   await run(['d1','execute','NJKB_DB','--local',`--persist-to=${state}`,`--file=${resolve('artifacts/production',manifest.execution_order[index])}`]);
   if((index+1)%20===0||index+1===manifest.total_chunks) console.error(`pass=${pass} chunk=${index+1}/${manifest.total_chunks}`);
  }
  console.log(JSON.stringify({pass,duration_ms:Date.now()-started,status:'PASS'}));
 }
 const output=await run(['d1','execute','NJKB_DB','--local',`--persist-to=${state}`,'--json','--command=SELECT (SELECT count(*) FROM njkb_references) AS references_count,(SELECT count(*) FROM ingestion_records) AS ingestion_records,(SELECT count(*) FROM ingestion_manifests) AS manifests,(SELECT count(*) FROM ingestion_issues) AS issues,(SELECT count(*) FROM vehicle_code_mappings) AS mappings;']);
 const parsed=JSON.parse(output.slice(output.indexOf('['))) as Array<{results:Array<Record<string,number>>}>;const counts=parsed[0]?.results[0];
 if(!counts||counts.references_count!==64874||counts.ingestion_records!==64874||counts.manifests!==2||counts.issues!==78||counts.mappings!==0) throw new Error(`Count mismatch: ${JSON.stringify(counts)}`);
 console.log(JSON.stringify({status:'PASS',counts}));
} finally {await rm(state,{recursive:true,force:true});}
