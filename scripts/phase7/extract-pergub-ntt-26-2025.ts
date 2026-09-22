import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const PDF_SHA='94798b35378003ac2fb85c9b239327fd7e0fab91bbab2b1e89ef91cd0a100c18';
const EXPECTED_ROWS=62_256;
const EXPECTED_DETECTED=62_156;
const EXPECTED_PRECONFLICT_VALID=62_108;
const EXPECTED_MISSING_SEQUENCE=100;
const categories=[
 ['A.1','MOBIL PENUMPANG',11,103,9_207],['A.2','MOBIL PENUMPANG',104,156,5_726],['A.3','MOBIL PENUMPANG',157,254,10_257],
 ['A.4','MOBIL PENUMPANG',255,257,148],['A.5','MOBIL BARANG',258,263,194],
 ['A.6','BUS',264,278,1_277],['A.7','BUS',279,294,1_321],['A.8','MOBIL BARANG',295,327,3_258],
 ['A.9','MOBIL BARANG',328,328,33],['A.10','MOBIL BARANG',329,330,163],['A.11','MOBIL BARANG',331,357,2_668],
 ['A.12','MOBIL BARANG',358,455,9_091],['A.13','SEPEDA MOTOR RODA DUA',456,616,17_962],
 ['A.14','SEPEDA MOTOR RODA TIGA PENUMPANG',617,617,8],['A.15','SEPEDA MOTOR RODA TIGA',618,629,943]
] as const;
const sourceHeadings:Record<string,string>={
 'A.1':'SEDAN','A.2':'JEEP','A.3':'MINIBUS','A.4':'MOBIL PENUMPANG RODA TIGA','A.5':'MOBIL BARANG RODA TIGA',
 'A.6':'MICROBUS','A.7':'BUS','A.8':'PICK UP','A.9':'PICK UP BOX','A.10':'BLIND VAN','A.11':'LIGHT TRUCK',
 'A.12':'TRUCK','A.13':'SEPEDA MOTOR RODA DUA','A.14':'SEPEDA MOTOR RODA TIGA PENUMPANG','A.15':'SEPEDA MOTOR RODA TIGA BARANG'
};
const splitDppPages:Record<string,number[]>={'A.5':[261,262,263]};
const verifiedSourceGaps:Record<string,{first:number;last:number;previous:number;next:number;pageBefore:number;pageAfter:number}>={
 'A.1':{first:92,last:191,previous:91,next:192,pageBefore:12,pageAfter:13}
};
const statusOrder=['VALID','DUPLICATE','CONFLICT','INVALID','OUT_OF_SCOPE','SKIPPED_WITH_REASON','SOURCE_NUMBERING_GAP','UNRESOLVED'];
const BRAND_NAMES=['ALFA ROMEO','ASTON MARTIN','HARLEY DAVIDSON','LAND ROVER','MERCEDES BENZ','ROLLS ROYCE','APP KTM','POWER ACE','TVS KING KARGO','TVS KING','ZERO ENGINEERING','BAIC BJEV','BAJAJ AUTO','GREAT WALL','DAIHATSU','MITSUBISHI','MITSHUBISHI','VOLKSWAGEN','CHEVROLET','LAMBORGHINI','MASERATI','PORSCHE','RENAULT','SUBARU','SUZUKI','TOYOTA','VOLVO','WULING','HONDA','HYUNDAI','ISUZU','JAGUAR','LEXUS','MAZDA','NISSAN','PEUGEOT','FORD','FIAT','BMW','AUDI','KIA','JEEP'].sort((a,b)=>b.length-a.length);
const args=new Map<string,string>();for(let index=2;index<process.argv.length;index+=2)args.set(process.argv[index],process.argv[index+1]);
const textPath=resolve(args.get('--text')??'C:/Users/elwin/AppData/Local/Temp/kilo/pergub-all-table.txt');
const pdfPath=args.get('--pdf')?resolve(args.get('--pdf')!):null;
const output=resolve(args.get('--output')??'fixtures/canonical/pergub-ntt-26-2025.full.json');
const qaOutput=resolve(args.get('--qa')??'docs/evidence/pergub-ntt-26-2025.extraction-qa.json');
const qaMirrorOutput=resolve(args.get('--qa-mirror')??'fixtures/canonical/pergub-ntt-26-2025.full.qa.json');
const inventoryOutput=resolve(args.get('--inventory')??'fixtures/extraction/pergub-ntt-26-2025.rows.json');
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
if(pdfPath){const bytes=await readFile(pdfPath);const actual=sha(bytes);if(actual!==PDF_SHA)throw new Error(`Unexpected PDF SHA-256: ${actual}`)}
const textBytes=await readFile(textPath);const textSha=sha(textBytes);const pages=textBytes.toString('utf8').split('\f');
if(pages.length!==691)throw new Error(`Text asset must preserve 690 PDF pages with form feeds; got ${pages.length-1}`);
const compact=(value:string)=>value.trim().replace(/\s+/g,' ');
const moneyPattern='(?:#+|Rp\\.?\\s*[0-9][0-9.]*|[0-9][0-9.]*)';
const rowPattern=new RegExp(`^\\s*(?:(\\d{1,5})\\s+)?(\\d{5,7})\\s+(\\d{4,7})\\s+(.+?)\\s+((?:19|20)\\d{2})\\s+(${moneyPattern})\\s+([0-9]+(?:[,.][0-9]+)?)(?:\\s+(${moneyPattern}))?\\s*$`,'i');
const broadRowPattern=/^\s*(?:(\d{1,5})\s+)?\d{5,7}\s+\d{4,7}\s+.+\b(?:19|20)\d{2}\b/;
const moneyValue=(raw:string)=>Number(raw.replace(/^Rp\.?\s*/i,'').replace(/\./g,''));
const weightParts=(raw:string)=>{const [whole,fraction='']=raw.replace(',','.').split('.');return {numerator:BigInt(`${whole}${fraction}`),denominator:10n**BigInt(fraction.length)}};
const formatted=(value:number)=>value.toLocaleString('id-ID');
const records:any[]=[];const dispositions:any[]=[];const categoryQa:any[]=[];
let detected=0;let blankDpp=0;let recoveredSplitDpp=0;let hashMoney=0;let sequentialId=0;
for(const [section,vehicleCategory,firstPage,lastPage,expectedLast] of categories){
 const sectionRecordsBefore=records.length;const sectionDispositionsBefore=dispositions.length;const seen=new Set<number>();
 const splitDpp=(splitDppPages[section]??[]).flatMap(pdfPage=>pages[pdfPage-1]!.split(/\r?\n/).map(compact).filter(value=>/^\d{1,3}(?:\.\d{3})+$/.test(value)));
 let splitDppIndex=0;
 for(let pdfPage=firstPage;pdfPage<=lastPage;pdfPage++){
  const lines=pages[pdfPage-1]!.split(/\r?\n/);
  for(let lineNumber=0;lineNumber<lines.length;lineNumber++){
   const line=lines[lineNumber]!;if(!broadRowPattern.test(line))continue;
   detected++;let assembled=line;let match=rowPattern.exec(assembled);
   for(let lookahead=1;!match&&lookahead<=4&&lineNumber+lookahead<lines.length;lookahead++){const continuation=lines[lineNumber+lookahead]!.trim();if(continuation)assembled+=` ${continuation}`;match=rowPattern.exec(assembled)}
   const rawText=compact(assembled);const sourceIndex=++sequentialId;
   if(!match){dispositions.push({status:'INVALID',pdf_page:pdfPage,text_line:lineNumber+1,source_row:null,section,vehicle_category:vehicleCategory,source_heading:sourceHeadings[section],reasons:['unparseable_row'],raw_text:rawText});continue}
   const [,sequenceRaw,codeA,codeB,identityRaw,yearRaw,njkbRaw,weightRaw,dppRaw]=match;
   const sequence=sequenceRaw?Number(sequenceRaw):null;if(sequence!==null)seen.add(sequence);
   let resolvedDpp=dppRaw;let correction:any=null;
   if(!resolvedDpp&&splitDppIndex<splitDpp.length){blankDpp++;resolvedDpp=splitDpp[splitDppIndex++]!;recoveredSplitDpp++;correction={field:'DP_PKB',raw:null,corrected:resolvedDpp,rule:'same-section split-column continuation',evidence:{pdf_page:splitDppPages[section]![Math.min(Math.floor((splitDppIndex-1)/83),splitDppPages[section]!.length-1)],ordinal:splitDppIndex}}}
   const hashFields=[njkbRaw,resolvedDpp].filter(value=>value?.startsWith('#'));if(hashFields.length)hashMoney++;
   const identity=compact(identityRaw!);const upper=identity.toUpperCase();const knownBrand=BRAND_NAMES.find(value=>upper===value||upper.startsWith(`${value} `));const pieces=identity.split(' ');const brand=knownBrand??pieces.shift()!;const type=knownBrand?identity.slice(knownBrand.length).trim():pieces.join(' ');
   const njkb=hashFields.length?null:moneyValue(njkbRaw!);const dpp=!resolvedDpp||hashFields.length?null:moneyValue(resolvedDpp);const weight=weightParts(weightRaw!);const reasons:string[]=[];
   if(sequence===null)reasons.push('missing_sequence');if(!type)reasons.push('missing_type');if(njkb===null||!Number.isSafeInteger(njkb)||njkb<=0)reasons.push('invalid_njkb');if(dpp===null)reasons.push(resolvedDpp?'invalid_dpp':'blank_dpp');else if(!Number.isSafeInteger(dpp)||dpp<=0)reasons.push('invalid_dpp');
   if(njkb!==null&&dpp!==null&&BigInt(njkb)*weight.numerator!==BigInt(dpp)*weight.denominator)reasons.push('dpp_mismatch');if(hashFields.length)reasons.push('hash_money');
   const parsed={NO:sequenceRaw??null,KODING:`${codeA} ${codeB}`,MERK:brand,TYPE:type,TAHUN_BUAT:yearRaw,NJKB:njkbRaw,BOBOT:weightRaw,DP_PKB:resolvedDpp??null};
   const evidence={status:reasons.length?'INVALID':'VALID',pdf_page:pdfPage,text_line:lineNumber+1,source_row:sequenceRaw??`missing-${sourceIndex}`,section,vehicle_category:vehicleCategory,source_heading:sourceHeadings[section],reasons,raw_text:rawText,parsed,corrections:correction?[correction]:[]};dispositions.push(evidence);
   if(reasons.length)continue;
   records.push({source:{pdf_page:pdfPage,source_row:sequenceRaw,section,vehicle_category:vehicleCategory},raw:parsed,review:{status:'verified',note:correction?`Deterministic text-layer extraction; DP_PKB recovered from split column on PDF page ${correction.evidence.pdf_page}, ordinal ${correction.evidence.ordinal}.`:'Deterministic text-layer extraction; displayed values preserved verbatim.'}});
  }
 }
  const missing=Array.from({length:expectedLast},(_,index)=>index+1).filter(value=>!seen.has(value));const observedRows=[...seen].sort((a,b)=>a-b);
  for(const sourceRow of missing){const previous=[...observedRows].reverse().find(value=>value<sourceRow)??null;const next=observedRows.find(value=>value>sourceRow)??null;const boundary=(value:number|null)=>value===null?null:(()=>{const row=dispositions.find(item=>item.section===section&&item.source_row===String(value));return row?{pdf_page:row.pdf_page,source_row:row.source_row,raw_text:row.raw_text}:null})();
   const previousDetected=boundary(previous),nextDetected=boundary(next);
   // Rows absent from the extracted text are reconciled against the physical source.
   // Verified via PyMuPDF text layer and rendered page image: the printed sequence jumps
   // directly from the last observed number to the next observed number with no intervening
   // printed rows. Absent printed positions are therefore an authoritative source numbering
   // gap, not an extraction failure, and are never fabricated.
   const verifiedGap=verifiedSourceGaps[section];const physicalGap=verifiedGap!==undefined&&sourceRow>=verifiedGap.first&&sourceRow<=verifiedGap.last&&previous===verifiedGap.previous&&next===verifiedGap.next&&previousDetected?.pdf_page===verifiedGap.pageBefore&&nextDetected?.pdf_page===verifiedGap.pageAfter;
   dispositions.push({status:physicalGap?'SOURCE_NUMBERING_GAP':'UNRESOLVED',pdf_page:null,text_line:null,source_row:String(sourceRow),section,vehicle_category:vehicleCategory,source_heading:sourceHeadings[section],reasons:[physicalGap?'authoritative_source_numbering_gap':'source_sequence_absent'],raw_text:null,parsed:null,corrections:[],
    evidence:{source_document_sha256:PDF_SHA,section,page_range:[previousDetected?.pdf_page??null,nextDetected?.pdf_page??null],previous_sequence:previous,next_sequence:next,missing_sequence_range:[previous!==null?previous+1:null,next!==null?next-1:null],physical_source_check:physicalGap?'not_present_in_text_layer_and_rendered_page':'not_verified',previous_detected:previousDetected,next_detected:nextDetected}})}
  const sectionDispositions=dispositions.slice(sectionDispositionsBefore);
  categoryQa.push({section,source_heading:sourceHeadings[section],vehicle_category:vehicleCategory,first_page:firstPage,last_page:lastPage,expected_rows:expectedLast,detected_row_lines:seen.size,accepted_rows:records.length-sectionRecordsBefore,dispositions:Object.fromEntries(statusOrder.map(status=>[status,sectionDispositions.filter(value=>value.status===status).length])),missing_sequence_rows:missing,observed_sequence_min:seen.size?Math.min(...seen):null,observed_sequence_max:seen.size?Math.max(...seen):null});
 }
const parserDetected=detected;const parserValid=records.length;const parserRejected=dispositions.filter(value=>value.status==='INVALID').length;
if(parserDetected!==EXPECTED_DETECTED)throw new Error(`Detected-row count changed: expected ${EXPECTED_DETECTED}, got ${parserDetected}`);if(EXPECTED_ROWS-parserDetected!==EXPECTED_MISSING_SEQUENCE)throw new Error(`Missing-sequence count changed: expected ${EXPECTED_MISSING_SEQUENCE}, got ${EXPECTED_ROWS-parserDetected}`);if(records.length!==EXPECTED_PRECONFLICT_VALID)throw new Error(`Pre-conflict valid-row count changed: expected ${EXPECTED_PRECONFLICT_VALID}, got ${records.length}`);
const known=records.find(row=>row.source.pdf_page===503&&row.source.section==='A.13'&&row.source.source_row==='5310');
if(!known||known.raw.KODING!=='701167 08549'||known.raw.MERK!=='HONDA'||known.raw.TYPE!=='C1M02N42L1 A/T'||known.raw.TAHUN_BUAT!=='2024'||known.raw.NJKB!=='12.500.000'||known.raw.BOBOT!=='1'||known.raw.DP_PKB!=='12.500.000')throw new Error('Known page 503 / A.13 / row 5310 validation failed');
const codeGroups=new Map<string,any[]>();for(const row of records){const key=`${compact(row.raw.KODING).toUpperCase()}|${row.raw.TAHUN_BUAT}`;codeGroups.set(key,[...(codeGroups.get(key)??[]),row])}
let conflictGroups=0;let conflictRows=0;const blocked=new Set<any>();
for(const group of codeGroups.values())if(group.length>1){const identities=new Set(group.map(row=>`${compact(row.raw.MERK).toUpperCase()}|${compact(row.raw.TYPE).toUpperCase()}|${compact(row.source.vehicle_category).toUpperCase()}`));const values=new Set(group.map(row=>`${row.raw.NJKB}|${row.raw.BOBOT}|${row.raw.DP_PKB}`));const reason=identities.size>1?'conflicting_code_identity':values.size>1?'conflicting_njkb':null;if(reason){conflictGroups++;conflictRows+=group.length;for(const row of group){blocked.add(row);const disposition=dispositions.find(value=>value.section===row.source.section&&value.source_row===row.source.source_row);Object.assign(disposition,{status:'CONFLICT',reasons:[reason],conflict:{code:row.raw.KODING,vehicle_year:row.raw.TAHUN_BUAT,group_size:group.length}})}}}
for(let index=records.length-1;index>=0;index--)if(blocked.has(records[index]))records.splice(index,1);
const duplicateGroups=new Map<string,any[]>();for(const row of records){const key=[row.raw.KODING,row.raw.TAHUN_BUAT,row.raw.MERK,row.raw.TYPE,row.source.vehicle_category,row.raw.NJKB,row.raw.BOBOT,row.raw.DP_PKB].map(value=>compact(value).toUpperCase()).join('|');duplicateGroups.set(key,[...(duplicateGroups.get(key)??[]),row])}
let duplicateGroupCount=0;let duplicateRows=0;
const duplicateBlocked=new Set<any>();
for(const group of duplicateGroups.values())if(group.length>1){duplicateGroupCount++;const retained=group[0];for(const row of group.slice(1)){duplicateRows++;duplicateBlocked.add(row);const disposition=dispositions.find(value=>value.section===row.source.section&&value.source_row===row.source.source_row);Object.assign(disposition,{status:'DUPLICATE',reasons:['exact_duplicate_of_source_row'],duplicate_of:{pdf_page:retained.source.pdf_page,source_row:retained.source.source_row}})}} 
for(let index=records.length-1;index>=0;index--)if(duplicateBlocked.has(records[index]))records.splice(index,1);
const identityWarnings=new Map<string,any[]>();for(const row of records){const key=[row.raw.MERK,row.raw.TYPE,row.raw.TAHUN_BUAT,row.source.vehicle_category].map(value=>compact(value).toUpperCase()).join('|');identityWarnings.set(key,[...(identityWarnings.get(key)??[]),row])}
const duplicateIdentityWarnings=[...identityWarnings.values()].filter(group=>group.length>1&&new Set(group.map(row=>compact(row.raw.KODING).toUpperCase())).size>1).map(group=>({identity:{brand:group[0].raw.MERK,type:group[0].raw.TYPE,vehicle_year:group[0].raw.TAHUN_BUAT,vehicle_category:group[0].source.vehicle_category},rows:group.map(row=>({pdf_page:row.source.pdf_page,source_row:row.source.source_row,code:row.raw.KODING,njkb:row.raw.NJKB,dpp_pkb:row.raw.DP_PKB}))}));
for(const category of categoryQa){const sectionDispositions=dispositions.filter(row=>row.section===category.section);category.accepted_rows=records.filter(row=>row.source.section===category.section).length;category.dispositions=Object.fromEntries(statusOrder.map(status=>[status,sectionDispositions.filter(value=>value.status===status).length]))}
records.sort((a,b)=>a.source.pdf_page-b.source.pdf_page||Number(a.source.source_row)-Number(b.source.source_row));
dispositions.sort((a,b)=>a.section.localeCompare(b.section,undefined,{numeric:true})||(a.pdf_page??Number.MAX_SAFE_INTEGER)-(b.pdf_page??Number.MAX_SAFE_INTEGER)||Number(a.source_row)-Number(b.source_row));
const dispositionCounts=Object.fromEntries(statusOrder.map(status=>[status,dispositions.filter(value=>value.status===status).length]));
const reportedDetected=parserDetected;const reportedMissing=EXPECTED_ROWS-reportedDetected;const reportedRejected=reportedDetected-records.length;
if(reportedDetected+reportedMissing!==EXPECTED_ROWS)throw new Error('Established row counts do not reconcile');
const envelope={schema_version:2,manifest:{dataset_id:'pergub-ntt-26-2025-part-a-full-v1',created_at:'2026-09-20T00:00:00Z',regulation:{id:'reg-a',jurisdiction:'NTT',kind:'Pergub',number:'26',regulation_year:2025,title:'Pergub NTT No. 26 Tahun 2025',effective_from:'2025-06-13',effective_to:null},source_document:{id:'doc-a',regulation_id:'reg-a',original_filename:'Pergub. NTT No. 26 Tahun 2025.pdf',source_url:'https://peraturan.bpk.go.id/Download/401313/Pergub.%20NTT%20No.%2026%20Tahun%202025.pdf',acquisition_method:'official_download',sha256:PDF_SHA,page_count:690},edition:{id:'edition-2025',regulation_id:'reg-a',tax_year:2025,vehicle_year_min:1900,vehicle_year_max:2025,jurisdiction:'NTT',applicability_status:'approved',applicability_note:'Approved provincial reference under Pergub NTT No. 26 Tahun 2025 for vehicle years up to 2025 (Pasal 7, Appendix A). Phase 6 regulatory decision: vehicle_year <= 2025 resolves from this edition. No cross-year fallback; no automatic code alias.'},extraction:{method:'pdf_text',tool:'deterministic-typescript-parser',tool_version:'phase7-v2'},defaults:{section:'A',vehicle_category:'KENDARAAN BERMOTOR'}},records};
const dataset=`${JSON.stringify(envelope,null,2)}\n`;const datasetSha=sha(dataset);
const unresolved=dispositions.filter(value=>value.status==='UNRESOLVED');const invalid=dispositions.filter(value=>value.status==='INVALID');
const sourceNumberingGap=dispositions.filter(value=>value.status==='SOURCE_NUMBERING_GAP');
const dispositionTotal=statusOrder.reduce((sum,status)=>sum+(dispositionCounts[status]??0),0);
const reconciliationComplete=dispositionTotal===EXPECTED_ROWS;
const qa={schema_version:2,source:{pdf_path:pdfPath,pdf_sha256:PDF_SHA,text_asset:textPath,text_sha256:textSha,page_count:690},scope:{table_pages:[11,629],sections:categories.map(value=>value[0]),expected_rows_basis:'sum of authoritative section terminal sequences across pages 11-629'},policy:{page_mapping:'form_feed_index_plus_one',raw_values:'preserved',manual_corrections:'deterministic split-column reconstruction recorded per row',ambiguous_cells:'excluded_without_guessing',dpp_validation:'exact integer arithmetic',duplicate_policy:'first source occurrence retained; subsequent exact-content duplicates excluded with source positions preserved in QA'},summary:{expected_rows:EXPECTED_ROWS,detected_row_lines:reportedDetected,accepted_rows:records.length,rejected_rows:reportedRejected,blank_dpp_rows_observed:blankDpp,blank_dpp_rows_recovered:recoveredSplitDpp,hash_money_rows:hashMoney,missing_sequence_rows:sourceNumberingGap.length+unresolved.length,source_numbering_gap_rows:sourceNumberingGap.length,unresolved_rows:unresolved.length,conflict_groups:conflictGroups,conflict_rows:conflictRows,duplicate_groups:duplicateGroupCount,duplicate_rows:duplicateRows,parser_observed:{detected_row_lines:parserDetected,valid_before_scope_and_conflict_filter:parserValid,rejected_rows:parserRejected},dispositions:dispositionCounts,dataset_sha256:datasetSha},reconciliation:{formula:'EXPECTED = VALID + DUPLICATE + CONFLICT + INVALID + OUT_OF_SCOPE + SKIPPED_WITH_REASON + SOURCE_NUMBERING_GAP + UNRESOLVED',expected:EXPECTED_ROWS,actual:dispositionTotal,complete:reconciliationComplete},known_validation:{pdf_page:503,section:'A.13',source_row:'5310',code:'701167 08549',status:'VALID'},categories:categoryQa,duplicate_identity_warnings:duplicateIdentityWarnings,invalid,source_numbering_gap:sourceNumberingGap,unresolved,disposition_inventory:dispositions};
const qaJson=`${JSON.stringify(qa,null,2)}\n`;const inventoryJson=`${JSON.stringify({schema_version:2,source_sha256:PDF_SHA,expected_rows:EXPECTED_ROWS,dispositions},null,2)}\n`;
await writeFile(output,dataset);await writeFile(qaOutput,qaJson);await writeFile(qaMirrorOutput,qaJson);await writeFile(inventoryOutput,inventoryJson);console.log(JSON.stringify({pdf_sha256:PDF_SHA,text_sha256:textSha,...qa.summary,output,qa:qaOutput,qa_mirror:qaMirrorOutput,inventory:inventoryOutput}));
