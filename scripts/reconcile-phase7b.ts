import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [,,source,...rest]=process.argv;const outputIndex=rest.indexOf('--output');
const output=outputIndex>=0?rest[outputIndex+1]:source?.replace(/\.json$/,'.reconciliation.json');
if(!source||!output) throw new Error('Usage: ... <extraction-qa.json> [--output reconciliation.json]');
const qa=JSON.parse(await readFile(source,'utf8')) as any;
const ambiguous=Array.isArray(qa.ambiguous)?qa.ambiguous:[];
const reasonCounts:Record<string,number>={};for(const row of ambiguous)for(const reason of row.reasons??[])reasonCounts[reason]=(reasonCounts[reason]??0)+1;
const isPergub='detected_row_lines' in qa.summary;
let counts:Record<string,number>;let inventory:any[];
if(isPergub){
 const expected=qa.summary.expected_rows as number,valid=qa.summary.accepted_rows as number;
 const conflictRows=qa.summary.conflict_rows as number;
 const missing=qa.summary.undetected_expected_rows as number;
 const unresolved=expected-valid-conflictRows;
 counts={EXPECTED:expected,VALID:valid,DUPLICATE:0,CONFLICT:conflictRows,INVALID:0,OUT_OF_SCOPE:0,SKIPPED_WITH_REASON:0,UNRESOLVED:unresolved};
 inventory=ambiguous.map((row:any)=>({...row,disposition:(row.reasons??[]).some((reason:string)=>reason.startsWith('conflicting_'))?'CONFLICT':'UNRESOLVED'}));
 const alreadyUnresolved=inventory.filter((row:any)=>row.disposition==='UNRESOLVED').length;
 const additionalExpected=Math.max(0,counts.UNRESOLVED-alreadyUnresolved);
 for(let index=0;index<additionalExpected;index++) inventory.push({expected_identity:`unmaterialized-expected-${index+1}`,source_page:null,source_row:null,surrounding_rows:null,extraction_status:'not_materialized',disposition:'UNRESOLVED',reason:index<missing?'missing_sequence_identity_not_materialized_by_phase7a_extractor':'phase7a_count_only_exception_not_uniquely_identified'});
}else{
 const expected=qa.summary.expected_rows as number,valid=qa.summary.accepted_rows as number;
 const conflicts=ambiguous.filter((row:any)=>(row.reasons??[]).some((reason:string)=>reason.startsWith('conflicting_'))).length;
 const unresolved=expected-valid-conflicts;
 counts={EXPECTED:expected,VALID:valid,DUPLICATE:0,CONFLICT:conflicts,INVALID:0,OUT_OF_SCOPE:0,SKIPPED_WITH_REASON:0,UNRESOLVED:unresolved};
 inventory=ambiguous.filter((row:any)=>/^\d+$/.test(String(row.source_row))).map((row:any)=>({...row,disposition:(row.reasons??[]).some((reason:string)=>reason.startsWith('conflicting_'))?'CONFLICT':'UNRESOLVED'}));
 for(const row of ambiguous.filter((row:any)=>!/^\d+$/.test(String(row.source_row)))) inventory.push({...row,disposition:'SKIPPED_WITH_REASON'});
}
const reconciled=counts.EXPECTED===counts.VALID+counts.DUPLICATE+counts.CONFLICT+counts.INVALID+counts.OUT_OF_SCOPE+counts.SKIPPED_WITH_REASON+counts.UNRESOLVED;
const result={schema_version:1,source_qa:source,source_qa_sha256:createHash('sha256').update(await readFile(source)).digest('hex'),generated_by:'scripts/reconcile-phase7b.ts',
 status:reconciled?'RECONCILED_WITH_UNRESOLVED':'FAILED',counts,equation:`${counts.EXPECTED} = ${counts.VALID} + ${counts.DUPLICATE} + ${counts.CONFLICT} + ${counts.INVALID} + ${counts.OUT_OF_SCOPE} + ${counts.SKIPPED_WITH_REASON} + ${counts.UNRESOLVED}`,
 reason_counts:reasonCounts,inventory};
await writeFile(output,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify({output,status:result.status,counts,inventory:inventory.length}));if(!reconciled)process.exitCode=2;
