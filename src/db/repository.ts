import { normalize } from './import';
import { DatabaseError } from '../errors';

async function database<T>(operation:()=>Promise<T>):Promise<T> {
 try {return await operation();} catch {throw new DatabaseError();}
}
export interface Reference {
 id:string; edition_id:string; regulation_id:string; source_document_id:string;
 tax_year:number; vehicle_year:number; source_code:string; brand:string; type:string;
 vehicle_category:string; njkb_rupiah:number; weight_micros:number|null; dpp_pkb_rupiah:number|null;
 source_pdf_page:number; source_row:string; raw_values:string; review_status:string;
 regulation_title:string; document_sha256:string; applicability_status:string;
}
export interface ReferenceEdition {
 id:string; regulation_id:string; tax_year:number; jurisdiction:string;
 applicability_status:'unresolved'|'historical'|'approved'; applicability_note:string;
 regulation_title:string; regulation_year:number; effective_from:string|null; effective_to:string|null;
}
export interface VerifiedCodeMapping {
 id:string; provider:string; api_brand_code:string; api_type_code:string;
 edition_id:string; target_source_code:string; vehicle_year:number;
 evidence_document_id:string; evidence_pdf_page:number; evidence_note:string;
}
const projection=`SELECT r.*,g.title AS regulation_title,d.sha256 AS document_sha256,e.applicability_status
 FROM njkb_references r JOIN regulations g ON g.id=r.regulation_id
 JOIN source_documents d ON d.id=r.source_document_id
 JOIN reference_editions e ON e.id=r.edition_id`;
export class NjkbRepository {
 constructor(private db:D1Database) {}
 // Candidate retrieval only. Returns arrays so ambiguity is never hidden by LIMIT 1.
 async byCode(editionId:string,sourceCode:string,vehicleYear:number):Promise<Reference[]> {
  const result=await database(()=>this.db.prepare(`${projection} WHERE r.edition_id=? AND r.source_code_normalized=? AND r.vehicle_year=? AND r.review_status='verified' ORDER BY r.id`).bind(editionId,normalize(sourceCode),vehicleYear).all<Reference>());
  return result.results;
 }
 async byIdentity(editionId:string,brand:string,type:string,vehicleYear:number,category:string):Promise<Reference[]> {
  const result=await database(()=>this.db.prepare(`${projection} WHERE r.edition_id=? AND r.brand_normalized=? AND r.type_normalized=? AND r.vehicle_year=? AND r.vehicle_category_normalized=? AND r.review_status='verified' ORDER BY r.id`).bind(editionId,normalize(brand),normalize(type),vehicleYear,normalize(category)).all<Reference>());
  return result.results;
 }
 async approvedEditions(jurisdiction:string,resolutionAsOf:string):Promise<ReferenceEdition[]> {
  const result=await database(()=>this.db.prepare(`SELECT e.*,g.title AS regulation_title
   ,g.regulation_year,g.effective_from,g.effective_to
   FROM reference_editions e JOIN regulations g ON g.id=e.regulation_id
   WHERE e.jurisdiction=? AND e.applicability_status='approved'
   AND (g.effective_from IS NULL OR g.effective_from<=?)
   AND (g.effective_to IS NULL OR g.effective_to>=?)
   ORDER BY g.regulation_year DESC,e.id`)
   .bind(normalize(jurisdiction),resolutionAsOf,resolutionAsOf).all<ReferenceEdition>());
  return result.results;
 }
 async hasYearCoverage(editionIds:string[],vehicleYear:number,category:string):Promise<boolean> {
  if(editionIds.length===0) return false;
  const marks=editionIds.map(()=>'?').join(',');
  const row=await database(()=>this.db.prepare(`SELECT 1 AS covered FROM njkb_references
   WHERE edition_id IN (${marks}) AND vehicle_year=? AND vehicle_category_normalized=?
   AND review_status='verified' LIMIT 1`).bind(...editionIds,vehicleYear,normalize(category)).first<{covered:number}>());
  return row!==null;
 }
 async byCodeAcrossEditions(editionIds:string[],sourceCode:string,vehicleYear:number):Promise<Reference[]> {
  if(editionIds.length===0) return [];
  const marks=editionIds.map(()=>'?').join(',');
  const result=await database(()=>this.db.prepare(`${projection} WHERE r.edition_id IN (${marks})
   AND r.source_code_normalized=? AND r.vehicle_year=? AND r.review_status='verified' ORDER BY r.id`)
   .bind(...editionIds,normalize(sourceCode),vehicleYear).all<Reference>());
  return result.results;
 }
 async byIdentityAcrossEditions(editionIds:string[],brand:string,type:string,vehicleYear:number,category:string):Promise<Reference[]> {
  if(editionIds.length===0) return [];
  const marks=editionIds.map(()=>'?').join(',');
  const result=await database(()=>this.db.prepare(`${projection} WHERE r.edition_id IN (${marks})
   AND r.brand_normalized=? AND r.type_normalized=? AND r.vehicle_year=?
   AND r.vehicle_category_normalized=? AND r.review_status='verified' ORDER BY r.id`)
   .bind(...editionIds,normalize(brand),normalize(type),vehicleYear,normalize(category)).all<Reference>());
  return result.results;
 }
 async verifiedMappings(provider:string,editionIds:string[],apiBrandCode:string,apiTypeCode:string,vehicleYear:number):Promise<VerifiedCodeMapping[]> {
  if(editionIds.length===0) return [];
  const marks=editionIds.map(()=>'?').join(',');
  const result=await database(()=>this.db.prepare(`SELECT id,provider,api_brand_code,api_type_code,edition_id,
   target_source_code,vehicle_year,evidence_document_id,evidence_pdf_page,evidence_note
   FROM vehicle_code_mappings WHERE provider=? AND edition_id IN (${marks})
   AND api_brand_code=? AND api_type_code=? AND vehicle_year=? AND review_status='verified' ORDER BY id`)
   .bind(normalize(provider),...editionIds,normalize(apiBrandCode),normalize(apiTypeCode),vehicleYear)
   .all<VerifiedCodeMapping>());
  return result.results;
 }
 async reviewCandidates(editionIds:string[],brand:string,vehicleYear:number,category:string):Promise<Reference[]> {
  if(editionIds.length===0) return [];
  const marks=editionIds.map(()=>'?').join(',');
  const result=await database(()=>this.db.prepare(`${projection} WHERE r.edition_id IN (${marks})
   AND r.brand_normalized=? AND r.vehicle_year=? AND r.vehicle_category_normalized=?
   AND r.review_status='verified' ORDER BY r.id LIMIT 20`)
   .bind(...editionIds,normalize(brand),vehicleYear,normalize(category)).all<Reference>());
  return result.results;
 }
}

export class MatchAuditRepository {
 constructor(private db:D1Database) {}
 async record(input:{resolutionAsOf:string;vehicleYear:number;editionId:string|null;referenceId:string|null;
  status:'matched'|'not_found'|'ambiguous'|'conflict'|'reference_unavailable';
  method:string;minimalVehicleSnapshot:Record<string,unknown>;reasons:unknown[]}):Promise<void> {
  await database(()=>this.db.prepare(`INSERT INTO match_audits
   (id,resolution_as_of,vehicle_year,edition_id,reference_id,status,method,minimal_vehicle_snapshot,reasons)
   VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),input.resolutionAsOf,input.vehicleYear,
   input.editionId,input.referenceId,input.status,input.method,JSON.stringify(input.minimalVehicleSnapshot),
   JSON.stringify(input.reasons)).run());
 }
}
