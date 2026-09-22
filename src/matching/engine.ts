import type { NormalizedVehicle } from '../vehicle/normalize';
import { MatchAuditRepository, NjkbRepository, type Reference, type ReferenceEdition } from '../db/repository';
import { normalize } from '../db/import';
import { DatabaseError, MatchingError } from '../errors';

type Status='matched'|'not_found'|'ambiguous'|'conflict'|'reference_unavailable';
type Candidate={reference_id:string;source_code:string;brand:string;type:string;vehicle_year:number;score?:number};
export type MatchResult=
 | {status:'matched';match_method:'exact_code'|'exact_identity'|'verified_code_mapping';njkb:number;weight_micros:number|null;dpp_pkb:number|null;source:{regulation:string;document_sha256:string;pdf_page:number;row:string;source_code:string;reference_id:string}}
 | {status:'reference_unavailable';vehicle_year:number;reason:string}
 | {status:'ambiguous';vehicle_year:number;method:string;candidates:Candidate[]}
 | {status:'conflict';vehicle_year:number;method:string;conflicts:string[];candidate:Candidate}
 | {status:'not_found';vehicle_year:number;review_candidates:Candidate[]};

// Regulatory boundary — Phase 6 final decision.
// vehicle_year <= 2025: Pergub NTT 26/2025 (provincial, jurisdiction='NTT').
// vehicle_year = 2026:  Permendagri 11/2026 (national, jurisdiction='ID').
// No cross-tier fallback: a pre-2026 vehicle must never resolve from the
// national 2026 edition, and a 2026 vehicle must never resolve from the
// provincial <=2025 edition.
function regulatoryTiersForYear(vehicleYear:number):{jurisdiction:string;maxVehicleYear?:number;minVehicleYear?:number}[] {
 if(vehicleYear<=2025) return [{jurisdiction:'NTT',maxVehicleYear:2025}];
 // vehicle_year === 2026 (and future years handled when new editions are added)
 return [{jurisdiction:'ID',minVehicleYear:2026}];
}

function candidate(row:Reference,score?:number):Candidate {
 return {reference_id:row.id,source_code:row.source_code,brand:row.brand,type:row.type,vehicle_year:row.vehicle_year,...(score===undefined?{}:{score})};
}
function identityConflicts(vehicle:NormalizedVehicle,row:Reference,checkType=true):string[] {
 const conflicts:string[]=[];
 if(normalize(row.brand)!==vehicle.brand) conflicts.push('brand');
 if(checkType && normalize(row.type)!==vehicle.type) conflicts.push('type');
 if(normalize(row.vehicle_category)!==vehicle.vehicleCategory) conflicts.push('vehicle_category');
 if(row.vehicle_year!==vehicle.vehicleYear) conflicts.push('vehicle_year');
 return conflicts;
}
function similarity(a:string,b:string):number {
 const x=normalize(a),y=normalize(b);if(x===y)return 1;
 const previous=Array.from({length:y.length+1},(_,index)=>index);
 for(let i=1;i<=x.length;i++) {let diagonal=previous[0];previous[0]=i;for(let j=1;j<=y.length;j++) {
  const old=previous[j];previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+(x[i-1]===y[j-1]?0:1));diagonal=old;
 }}
 return Math.max(0,1-previous[y.length]/Math.max(x.length,y.length,1));
}

export class NjkbMatchingEngine {
 constructor(private references:NjkbRepository,private audits?:MatchAuditRepository) {}
 async match(vehicle:NormalizedVehicle,resolutionAsOf:string):Promise<MatchResult> {
  try {return await this.matchInternal(vehicle,resolutionAsOf);}
  catch(error) {if(error instanceof DatabaseError) throw error;throw new MatchingError();}
 }
 private async matchInternal(vehicle:NormalizedVehicle,resolutionAsOf:string):Promise<MatchResult> {
  // Determine which authority tiers apply for this vehicle year.
  // The boundary is a final regulatory decision: no cross-tier fallback is permitted.
  // vehicle_year <= 2025 → NTT only (Pergub 26/2025)
  // vehicle_year = 2026  → national only (Permendagri 11/2026)
  const tierConfigs=regulatoryTiersForYear(vehicle.vehicleYear);
  const tiers:ReferenceEdition[][]=[];
  for(const config of tierConfigs) {
   const editions=await this.references.approvedEditions(config.jurisdiction,resolutionAsOf);
   if(editions.length>0) tiers.push(editions);
  }
  if(tiers.length===0) return this.finish(vehicle,resolutionAsOf,{status:'reference_unavailable',vehicle_year:vehicle.vehicleYear,
   reason:'Tidak ada edisi referensi berstatus approved yang berlaku'},'edition_unavailable',[]);

  let hasCoverage=false;
  const review:Candidate[]=[];
  for(const tier of tiers) {
   const editionIds=tier.map(edition=>edition.id);
   if(!await this.references.hasYearCoverage(editionIds,vehicle.vehicleYear,vehicle.vehicleCategory)) continue;
   hasCoverage=true;

   const code=await this.references.byCodeAcrossEditions(editionIds,vehicle.typeCode,vehicle.vehicleYear);
   if(code.length>1) return this.finish(vehicle,resolutionAsOf,{status:'ambiguous',vehicle_year:vehicle.vehicleYear,method:'exact_code',candidates:code.map(row=>candidate(row))},'exact_code',code.map(row=>row.id));
   if(code.length===1) {
    const conflicts=identityConflicts(vehicle,code[0]);
    if(conflicts.length) return this.finish(vehicle,resolutionAsOf,{status:'conflict',vehicle_year:vehicle.vehicleYear,method:'exact_code',conflicts,candidate:candidate(code[0])},'exact_code',conflicts);
    return this.matched(vehicle,resolutionAsOf,code[0],'exact_code');
   }

   const identity=await this.references.byIdentityAcrossEditions(editionIds,vehicle.brand,vehicle.type,vehicle.vehicleYear,vehicle.vehicleCategory);
   if(identity.length>1) return this.finish(vehicle,resolutionAsOf,{status:'ambiguous',vehicle_year:vehicle.vehicleYear,method:'exact_identity',candidates:identity.map(row=>candidate(row))},'exact_identity',identity.map(row=>row.id));
   if(identity.length===1) return this.matched(vehicle,resolutionAsOf,identity[0],'exact_identity');

   const mappings=await this.references.verifiedMappings('BPAD_NTT',editionIds,vehicle.brandCode,vehicle.typeCode,vehicle.vehicleYear);
   const mapped:Reference[]=[];
   for(const mapping of mappings) mapped.push(...await this.references.byCodeAcrossEditions([mapping.edition_id],mapping.target_source_code,vehicle.vehicleYear));
   const unique=[...new Map(mapped.map(row=>[row.id,row])).values()];
   if(unique.length>1) return this.finish(vehicle,resolutionAsOf,{status:'ambiguous',vehicle_year:vehicle.vehicleYear,method:'verified_code_mapping',candidates:unique.map(row=>candidate(row))},'verified_code_mapping',unique.map(row=>row.id));
   if(unique.length===1) {
    const conflicts=identityConflicts(vehicle,unique[0],false);
    if(conflicts.length) return this.finish(vehicle,resolutionAsOf,{status:'conflict',vehicle_year:vehicle.vehicleYear,method:'verified_code_mapping',conflicts,candidate:candidate(unique[0])},'verified_code_mapping',conflicts);
    return this.matched(vehicle,resolutionAsOf,unique[0],'verified_code_mapping');
   }

   review.push(...(await this.references.reviewCandidates(editionIds,vehicle.brand,vehicle.vehicleYear,vehicle.vehicleCategory))
    .map(row=>({row,score:similarity(vehicle.type,row.type)})).filter(item=>item.score>=0.5)
    .map(item=>candidate(item.row,Number(item.score.toFixed(4)))));
  }

  if(!hasCoverage) return this.finish(vehicle,resolutionAsOf,{status:'reference_unavailable',vehicle_year:vehicle.vehicleYear,
   reason:'Tidak ada cakupan authoritative untuk tahun pembuatan dan kategori kendaraan'},'year_coverage_unavailable',[]);
  const fuzzy=[...new Map(review.sort((a,b)=>(b.score??0)-(a.score??0)).map(item=>[item.reference_id,item])).values()].slice(0,5);
  return this.finish(vehicle,resolutionAsOf,{status:'not_found',vehicle_year:vehicle.vehicleYear,review_candidates:fuzzy},'none',fuzzy.map(item=>item.reference_id));
 }
 private async matched(vehicle:NormalizedVehicle,resolutionAsOf:string,row:Reference,method:'exact_code'|'exact_identity'|'verified_code_mapping'):Promise<MatchResult> {
  return this.finish(vehicle,resolutionAsOf,{status:'matched',match_method:method,njkb:row.njkb_rupiah,weight_micros:row.weight_micros,dpp_pkb:row.dpp_pkb_rupiah,
   source:{regulation:row.regulation_title,document_sha256:row.document_sha256,pdf_page:row.source_pdf_page,row:row.source_row,source_code:row.source_code,reference_id:row.id}},method,[],row);
 }
 private async finish(vehicle:NormalizedVehicle,resolutionAsOf:string,result:MatchResult,method:string,reasons:unknown[],reference?:Reference):Promise<MatchResult> {
  if(this.audits) await this.audits.record({resolutionAsOf,vehicleYear:vehicle.vehicleYear,editionId:reference?.edition_id??null,
   referenceId:reference?.id??null,status:result.status as Status,method,
   minimalVehicleSnapshot:{vehicle_category:vehicle.vehicleCategory,brand:vehicle.brand,brand_code:vehicle.brandCode,type:vehicle.type,type_code:vehicle.typeCode,vehicle_year:vehicle.vehicleYear},reasons});
  return result;
 }
}
