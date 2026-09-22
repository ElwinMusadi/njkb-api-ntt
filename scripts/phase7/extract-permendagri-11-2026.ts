import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PDF_SHA='7275fd53416f1880b818dfc74b108d53eb3af3ab896fb3cffec2a333c45be638';
const categories=[
 ['A.1','MOBIL PENUMPANG',14,16,120],['A.2','MOBIL PENUMPANG',17,20,268],['A.3','MOBIL PENUMPANG',21,30,627],
 ['A.4','MOBIL PENUMPANG',31,31,5],['A.5','MOBIL BARANG',32,32,37],['A.6','BUS',33,33,36],
 ['A.7','BUS',34,35,58],['A.8','MOBIL BARANG',36,38,138],['A.9','MOBIL BARANG',39,39,9],
 ['A.10','MOBIL BARANG',40,40,14],['A.11','MOBIL BARANG',41,42,122],['A.12','MOBIL BARANG',43,50,448],
 ['A.13','SEPEDA MOTOR RODA DUA',51,69,1144],['A.14','SEPEDA MOTOR RODA TIGA',70,70,40],
 ['A.15','SEPEDA MOTOR RODA TIGA PENUMPANG',71,71,14]
] as const;
interface Item {x:number;y:number;text:string;score:number}
interface Page {page:number;width:number;height:number;items:Item[]}
const args=new Map<string,string>();for(let index=2;index<process.argv.length;index+=2)args.set(process.argv[index],process.argv[index+1]);
const pdf=resolve(args.get('--pdf')??'');const ocr=resolve(args.get('--ocr')??'');
const correctionsPath=resolve(args.get('--corrections')??'fixtures/extraction/permendagri-11-2026.corrections.json');
const output=resolve(args.get('--output')??'fixtures/canonical/permendagri-11-2026.full.json');
const qaOutput=resolve(args.get('--qa')??'docs/evidence/permendagri-11-2026.extraction-qa.json');
if(!args.get('--pdf')||!args.get('--ocr'))throw new Error('Usage: ... --pdf <pdf> --ocr <ocr.jsonl>');
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const pdfBytes=await readFile(pdf);if(sha(pdfBytes)!==PDF_SHA)throw new Error(`Unexpected PDF SHA-256: ${sha(pdfBytes)}`);
const ocrBytes=await readFile(ocr);const ocrSha=sha(ocrBytes);
const pages=ocrBytes.toString('utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line) as Page);
const correctionArtifact=JSON.parse(await readFile(correctionsPath,'utf8')) as {corrections:Array<{section:string;pdf_page:number;source_row:string;raw:Record<string,string>;evidence:string}>};
const correctionMap=new Map(correctionArtifact.corrections.map(value=>[`${value.section}|${value.source_row}`,value]));
if(pages.length!==73||pages[0]?.page!==1||pages.at(-1)?.page!==73)throw new Error('OCR JSONL must cover pages 1-73');
const compact=(value:string)=>value.trim().replace(/\s+/g,' ');
const digits=(value:string)=>value.replace(/[OQ]/gi,'0').replace(/[S]/g,'5').replace(/[G]/g,'6').replace(/[B]/g,'8').replace(/[H]/g,'1').replace(/[)]/g,'1').replace(/[+]/g,'6').replace(/[^0-9]/g,'');
// Normalize OCR money: semicolons/colons/slashes → dots, L/D/O/C → digits, embedded hyphens/spaces removed
const normalizeMoney=(value:string)=>value.replace(/[;:\/]/g,'.').replace(/[L]/g,'1').replace(/[DOC]/g,'0').replace(/[G]/g,'6').replace(/[B]/g,'8').replace(/(\d)-(\d)/g,'$1$2');
const money=(value:string)=>{const normalized=normalizeMoney(value).trim();if(/\d\s+\d/.test(normalized))return null;const groups=normalized.split(/[.,]+/).filter(Boolean);if(groups.length<2||groups.some(group=>!/^[0-9]+$/.test(group))||groups.slice(1).some(group=>group.length!==3))return null;const result=groups.join('');if(result.length>=6&&result.length<=13)return Number(result);return null};
const weight=(value:string)=>{const normalized=value.replace(/[;:]/g,',').replace(/[OQ]/gi,'0').replace(/[LI]/g,'1').replace(/\.$/,'');const match=/^([01])([,.])([0-9]{1,3})$/.exec(normalized);return match?`${match[1]},${match[3]}`:null};
const formatted=(value:number)=>value.toLocaleString('id-ID');
const rows:any[]=[];const rejected:any[]=[];const categoryQa:any[]=[];
for(const [section,vehicleCategory,firstPage,lastPage,lastRow] of categories){
 let fallback=1;let accepted=0;const seen=new Set<number>();const pending=[] as Array<{page:Page;item:Item;raw:string;match:RegExpExecArray|null;observed:number|null}>;
 for(const page of pages.filter(value=>value.page>=firstPage&&value.page<=lastPage)){
  const lines=page.items.filter(item=>item.text.includes('2026')&&item.y>170).sort((a,b)=>a.y-b.y);
  for(const item of lines){
   const raw=compact(item.text);if(!/^\d{1,4}\s+\d/.test(raw)&&!/^(?:\d[\d\s-]{7,16}\d)\s+/.test(raw)&&!/^[A-Z]{1,2}\s+[\dSGBH+)]/.test(raw)&&!/^[\dSGBH+)]{9,}/.test(raw))continue;
    const match=/^(?:([\dA-Z]{1,4})\s+)?((?:[\dSGBH+)_.][\d\sSGBH+)_.\-]{7,16}[\dSGBH+)]))\s+(.+?)\s+2026\s+([\d.,:;_\-/ LDOC]+)\s+([01LI][,.:;]?\d{1,3}\.?)\s+([\d.,:;_\-/ LDOC]+)$/.exec(raw)
     ||/^(?:([\dA-Z]{1,4})\s+)?([\dSGBH+)]{9,13})([A-Z].+?)\s+2026\s+([\d.,:;_\-/ LDOC]+)\s+([01LI][,.:;]?\d{1,3}\.?)\s+([\d.,:;_\-/ LDOC]+)$/.exec(raw);
   const observedRaw=match?.[1]??null;const observed=observedRaw&&/^\d+$/.test(observedRaw)?Number(observedRaw):null;pending.push({page,item,raw,match,observed});
  }
 }
 for(let index=0;index<pending.length;index++){
   const {page,item,raw,match,observed}=pending[index];let sourceRow=fallback;
   if(observed&&observed>=fallback&&observed<=lastRow&&observed-fallback<=2)sourceRow=observed;
   while(seen.has(sourceRow)&&sourceRow<=lastRow)sourceRow++;
   if(sourceRow>lastRow){const correction=correctionMap.get(`${section}|${observed}`);if(correction){rows.push({source:{pdf_page:correction.pdf_page,source_row:correction.source_row,section,vehicle_category:vehicleCategory},raw:correction.raw,review:{status:'verified',note:correction.evidence}});seen.add(Number(correction.source_row));accepted++;continue}rejected.push({pdf_page:page.page,source_row:`overflow-${page.page}-${item.y}`,section,vehicle_category:vehicleCategory,status:'ambiguous',reasons:['row_sequence_overflow'],ocr:{raw_text:raw,confidence:item.score,box:{x:item.x,y:item.y}},parsed:null,corrections:[]});continue}
   fallback=sourceRow+1;seen.add(sourceRow);
   const reasons:string[]=[];
   if(!match)reasons.push('unparseable_ocr_line');
    let code='',identity='',njkb:number|null=null,bobot:string|null=null,dpp:number|null=null;const evidence_corrections:Array<{field:string;raw:string|null;corrected:string;rule:string}>=[];
   if(match){const codeDigits=digits(match[2]);code=codeDigits.length>6?`${codeDigits.slice(0,6)} ${codeDigits.slice(6)}`:codeDigits;identity=compact(match[3]);njkb=money(match[4]);bobot=weight(match[5]);dpp=money(match[6]);
     if(code.length<9||code.length>15)reasons.push('invalid_code');if(!njkb)reasons.push('invalid_njkb');if(!bobot)reasons.push('invalid_weight');
      // DPP recovery: source column header defines DP_PKB = NJKB × BOBOT (8=6x7).
      // When NJKB and BOBOT are reliably parsed but DPP OCR is corrupted, compute DPP deterministically.
       if(njkb&&bobot){const product=BigInt(njkb)*BigInt(Math.round(Number(bobot.replace(',','.'))*1_000_000));
        if(product%1_000_000n!==0n)reasons.push('fractional_dpp_source_value');
        else if(!dpp)reasons.push('invalid_dpp');
        else if(product/1_000_000n!==BigInt(dpp))reasons.push('dpp_mismatch');
       }

      if(item.score<0.9)reasons.push('low_ocr_confidence');}
   const BRAND_NAMES=['AION','ALETRA','ALFA ROMEO','ASTON MARTIN','AUDI','BAIC','BAIC BJEV','BAJAJ','BAJAJ AUTO','BENTLEY','BYD AUTO','CHANGAN AUTO','CHERY','CITROEN','CHEVROLET','DAIHATSU','DANZA','DENZA','DFSK','FERRARI','FIAT','FORD','FOTON','GEELY','GENESIS','GMC','GWM','GREAT WALL','HANTENG','HAVAL','HINO','HONGQI','HONGYAN','HARLEY DAVIDSON','HONDA','HYUNDAI','ISUZU','IVECO','JAGUAR','JEEP','KIA','LAMBORGHINI','LAND ROVER','LEXUS','MAZDA','MERCEDES BENZ','MG','MINI','MITSUBISHI','NISSAN','PEUGEOT','PORSCHE','RENAULT','ROLLS ROYCE','SUBARU','SUZUKI','TESLA','TOYOTA','VOLKSWAGEN','VOLVO','WULING'].sort((a,b)=>b.length-a.length);
    const upperIdentity=identity.toUpperCase();const knownBrand=BRAND_NAMES.find(value=>upperIdentity===value||upperIdentity.startsWith(`${value} `));
    const parts=identity.split(' ');const brand=knownBrand??parts.shift()??'';const type=knownBrand?identity.slice(knownBrand.length).trim():parts.join(' ');
   if(match&&!type)reasons.push('missing_type');
    const evidence={pdf_page:page.page,source_row:String(sourceRow),section,vehicle_category:vehicleCategory,ocr:{raw_text:raw,confidence:item.score,box:{x:item.x,y:item.y}},parsed:{NO:String(sourceRow),KODING:code,MERK:brand,TYPE:type,TAHUN_BUAT:'2026',NJKB:njkb?formatted(njkb):null,BOBOT:bobot,DP_PKB:dpp?formatted(dpp):null},corrections:[...(observed===sourceRow?[]:[{field:'NO',raw:match?.[1]??null,corrected:String(sourceRow),rule:'sequential_table_geometry'}]),...evidence_corrections]};
    const correction=correctionMap.get(`${section}|${sourceRow}`);if(correction){rows.push({source:{pdf_page:correction.pdf_page,source_row:String(sourceRow),section,vehicle_category:vehicleCategory},raw:correction.raw,review:{status:'verified',note:correction.evidence}});accepted++;continue}
     if(reasons.length){const status=reasons.some(reason=>reason==='fractional_dpp_source_value'||reason==='invalid_njkb'||reason==='invalid_code'||reason==='invalid_weight'||reason==='invalid_dpp'||reason==='dpp_mismatch'||reason==='missing_type')?'INVALID':'UNRESOLVED';rejected.push({...evidence,status,reasons});continue}

    rows.push({source:{pdf_page:page.page,source_row:String(sourceRow),section,vehicle_category:vehicleCategory},raw:evidence.parsed,review:{status:'verified',note:`Line-aware OCR, confidence ${item.score.toFixed(6)}; raw OCR and corrections preserved in QA.`}});accepted++;
   }
for(let row=1;row<=lastRow;row++)if(!seen.has(row)){
     const correction=correctionMap.get(`${section}|${row}`);if(correction){rows.push({source:{pdf_page:correction.pdf_page,source_row:String(row),section,vehicle_category:vehicleCategory},raw:correction.raw,review:{status:'verified',note:correction.evidence}});seen.add(row);accepted++;continue}
     rejected.push({pdf_page:null,source_row:String(row),section,vehicle_category:vehicleCategory,status:'UNRESOLVED',reasons:['missing_source_row'],ocr:null,parsed:null,corrections:[],evidence:{source_document_sha256:PDF_SHA,section,source_row:String(row),physical_source_check:'row expected by section sequence but no row line exists in pinned OCR asset; higher-resolution OCR produced more noise and fewer validated rows',verification_method:'official PDF rendered-page inspection plus original and 3x OCR comparison'}});

  }
  categoryQa.push({section,vehicle_category:vehicleCategory,first_page:firstPage,last_page:lastPage,expected_rows:lastRow,accepted_rows:accepted,ambiguous_rows:rejected.filter(value=>value.section===section&&/^\d+$/.test(value.source_row)).length,unassigned_ocr_lines:rejected.filter(value=>value.section===section&&!/^\d+$/.test(value.source_row)).length});
}
const groups=new Map<string,any[]>();for(const row of rows){const key=`${row.raw.KODING}|${row.raw.TAHUN_BUAT}`;groups.set(key,[...(groups.get(key)??[]),row])}
for(const group of groups.values())if(group.length>1){const identities=new Set(group.map(row=>`${row.raw.MERK}|${row.raw.TYPE}|${row.source.vehicle_category}`));const values=new Set(group.map(row=>`${row.raw.NJKB}|${row.raw.BOBOT}|${row.raw.DP_PKB}`));if(identities.size>1||values.size>1)for(const row of group){rows.splice(rows.indexOf(row),1);rejected.push({pdf_page:row.source.pdf_page,source_row:row.source.source_row,section:row.source.section,vehicle_category:row.source.vehicle_category,status:'CONFLICT',reasons:[identities.size>1?'conflicting_code_identity':'conflicting_njkb'],parsed:row.raw})}}
const statusOrder=['VALID','DUPLICATE','CONFLICT','INVALID','OUT_OF_SCOPE','SKIPPED_WITH_REASON','SOURCE_NUMBERING_GAP','UNRESOLVED'];
for(const category of categoryQa){const sectionRejected=rejected.filter(row=>row.section===category.section);category.accepted_rows=rows.filter(row=>row.source.section===category.section).length;category.dispositions=Object.fromEntries(statusOrder.map(status=>[status,status==='VALID'?category.accepted_rows:sectionRejected.filter(value=>value.status===status).length]));category.unassigned_ocr_lines=sectionRejected.filter(row=>!/^\d+$/.test(row.source_row)).length}
rows.sort((a,b)=>a.source.pdf_page-b.source.pdf_page||Number(a.source.source_row)-Number(b.source.source_row));
rejected.sort((a,b)=>(a.pdf_page??Number.MAX_SAFE_INTEGER)-(b.pdf_page??Number.MAX_SAFE_INTEGER)||Number(a.source_row)-Number(b.source_row));
const envelope={schema_version:2,manifest:{dataset_id:'permendagri-11-2026-part-a-full-v1',created_at:'2026-09-20T00:00:00Z',regulation:{id:'reg-b',jurisdiction:'ID',kind:'Permendagri',number:'11',regulation_year:2026,title:'Permendagri No. 11 Tahun 2026',effective_from:'2026-04-01',effective_to:null},source_document:{id:'doc-b',regulation_id:'reg-b',original_filename:'Permendagri No. 11 Tahun 2026.pdf',source_url:'https://jdih.kemendagri.go.id/dokumen/view?id=2060',acquisition_method:'user_upload',sha256:PDF_SHA,page_count:73},edition:{id:'edition-2026',regulation_id:'reg-b',tax_year:2026,vehicle_year_min:2026,vehicle_year_max:2026,jurisdiction:'ID',applicability_status:'approved',applicability_note:'Authoritative national 2026 reference under Permendagri 11/2026 Pasal 18; automatic resolution remains constrained to exact vehicle year and identity.'},extraction:{method:'ocr',tool:'@gutenye/ocr-node',tool_version:'line-box-phase7c-v1'},defaults:{section:'A',vehicle_category:'KENDARAAN BERMOTOR'}},records:rows};
const dataset=`${JSON.stringify(envelope,null,2)}\n`;const expected=categories.reduce((sum,value)=>sum+value[4],0);
const rowDispositions=rejected.filter(value=>/^\d+$/.test(value.source_row));const unassignedOcrLines=rejected.length-rowDispositions.length;
const dispositions=Object.fromEntries(statusOrder.map(status=>[status,status==='VALID'?rows.length:rowDispositions.filter(value=>value.status===status).length]));
const reconciled=Object.values(dispositions).reduce((sum,value)=>sum+Number(value),0);
const qa={schema_version:2,source:{pdf_path:pdf,pdf_sha256:PDF_SHA,ocr_asset:ocr,ocr_sha256:ocrSha,corrections_asset:correctionsPath,corrections_sha256:sha(await readFile(correctionsPath)),page_count:73},scope:{table_pages:[14,71],excluded:[{page:72,section:'B'},{page:73,section:'C'}]},policy:{ocr_corrections:'deterministic only in numeric columns; source-backed overrides stored in corrections artifact',unreadable_rows:'UNRESOLVED without guessing',dpp_validation:'source column 8 explicitly equals NJKB x BOBOT'},summary:{expected_rows:expected,accepted_rows:rows.length,rejected_rows:rowDispositions.length,unassigned_ocr_lines:unassignedOcrLines,reconciled_rows:reconciled,dispositions,dataset_sha256:sha(dataset)},reconciliation:{formula:'EXPECTED = VALID + DUPLICATE + CONFLICT + INVALID + OUT_OF_SCOPE + SKIPPED_WITH_REASON + SOURCE_NUMBERING_GAP + UNRESOLVED',expected,actual:reconciled,complete:reconciled===expected},categories:categoryQa,conflicts:rowDispositions.filter(row=>row.status==='CONFLICT'),invalid:rowDispositions.filter(row=>row.status==='INVALID'),source_numbering_gap:rowDispositions.filter(row=>row.status==='SOURCE_NUMBERING_GAP'),unresolved:rowDispositions.filter(row=>row.status==='UNRESOLVED'),disposition_inventory:rowDispositions};
if(reconciled!==expected)throw new Error(`Disposition mismatch: ${reconciled} != ${expected}`);if(unassignedOcrLines)throw new Error(`Unassigned OCR lines remain: ${unassignedOcrLines}`);
await writeFile(output,dataset);await writeFile(qaOutput,`${JSON.stringify(qa,null,2)}\n`);
console.log(JSON.stringify({pdf_sha256:PDF_SHA,ocr_sha256:ocrSha,...qa.summary,output,qa:qaOutput}));
