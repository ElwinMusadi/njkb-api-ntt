import { readFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';

interface Count {n:number;}
interface ExpectedDataset {manifest:{edition:{id:string};source_document:{id:string;sha256:string}};records:unknown[];}

const paths=process.argv.slice(2);
if(paths.length===0) {
 console.error('Usage: node --import tsx scripts/verify-phase7-local.ts <full-dataset.json> [...]');
 process.exit(1);
}
const datasets=await Promise.all(paths.map(async path=>JSON.parse(await readFile(path,'utf8')) as ExpectedDataset));
const expectedReferences=datasets.reduce((sum,dataset)=>sum+dataset.records.length,0);
const platform=await getPlatformProxy<{NJKB_DB:D1Database}>({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'}});
try {
 const db=platform.env.NJKB_DB;
 const failures:string[]=[];
 // Cloudflare D1 blocks some PRAGMA statements through prepared queries. Integrity
 // is therefore verified through relational invariants below and migration/import errors.
 const count=async(table:string)=>(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<Count>())?.n??-1;
 const counts={
  regulations:await count('regulations'),source_documents:await count('source_documents'),
  reference_editions:await count('reference_editions'),njkb_references:await count('njkb_references'),
  vehicle_code_mappings:await count('vehicle_code_mappings'),ingestion_manifests:await count('ingestion_manifests'),
  ingestion_records:await count('ingestion_records'),ingestion_issues:await count('ingestion_issues')
 };
 if(counts.njkb_references!==expectedReferences) failures.push(`njkb_references=${counts.njkb_references}, expected=${expectedReferences}`);
 if(counts.ingestion_records!==expectedReferences) failures.push(`ingestion_records=${counts.ingestion_records}, expected=${expectedReferences}`);
 if(counts.ingestion_manifests!==datasets.length) failures.push(`ingestion_manifests=${counts.ingestion_manifests}, expected=${datasets.length}`);
 if(counts.vehicle_code_mappings!==0) failures.push(`vehicle_code_mappings=${counts.vehicle_code_mappings}, expected=0`);
 const incomplete=await db.prepare("SELECT count(*) AS n FROM ingestion_manifests WHERE status<>'completed'").first<Count>();
 if((incomplete?.n??0)!==0) failures.push(`incomplete_manifests=${incomplete?.n}`);
 const outOfScope=await db.prepare(`SELECT count(*) AS n FROM njkb_references r JOIN reference_editions e ON e.id=r.edition_id
  WHERE e.vehicle_year_min IS NULL OR e.vehicle_year_max IS NULL OR r.vehicle_year NOT BETWEEN e.vehicle_year_min AND e.vehicle_year_max`).first<Count>();
 if((outOfScope?.n??0)!==0) failures.push(`out_of_scope=${outOfScope?.n}`);
 const orphan=await db.prepare(`SELECT count(*) AS n FROM njkb_references r LEFT JOIN ingestion_records i ON i.reference_id=r.id WHERE i.reference_id IS NULL`).first<Count>();
 if((orphan?.n??0)!==0) failures.push(`references_without_ingestion_record=${orphan?.n}`);
 for(const dataset of datasets) {
  const edition=await db.prepare('SELECT count(*) AS n FROM njkb_references WHERE edition_id=?').bind(dataset.manifest.edition.id).first<Count>();
  if((edition?.n??-1)!==dataset.records.length) failures.push(`${dataset.manifest.edition.id}=${edition?.n}, expected=${dataset.records.length}`);
  const document=await db.prepare('SELECT sha256 FROM source_documents WHERE id=?').bind(dataset.manifest.source_document.id).first<{sha256:string}>();
  if(document?.sha256!==dataset.manifest.source_document.sha256) failures.push(`${dataset.manifest.source_document.id} hash mismatch`);
 }
 const queryPlans={
  exact_code:(await db.prepare("EXPLAIN QUERY PLAN SELECT id FROM njkb_references WHERE edition_id='edition-2025' AND source_code_normalized='701167 08549' AND vehicle_year=2024 AND review_status='verified'").all()).results,
  exact_identity:(await db.prepare("EXPLAIN QUERY PLAN SELECT id FROM njkb_references WHERE edition_id='edition-2025' AND brand_normalized='HONDA' AND type_normalized='C1M02N42L1 A/T' AND vehicle_year=2024 AND vehicle_category_normalized='SEPEDA MOTOR RODA DUA' AND review_status='verified'").all()).results
 };
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',expected_references:expectedReferences,counts,failures,query_plans:queryPlans},null,2));
 if(failures.length) process.exitCode=2;
} finally {await platform.dispose();}
