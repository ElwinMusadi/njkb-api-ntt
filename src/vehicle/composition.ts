import {BpadError,type FullVehicleProvider} from '../bpad/adapter';
import {normalizeBpadRecord,type NormalizedBpadRecord} from '../bpad/normalize';
import type {BpadVehicleRecord} from '../bpad/types';
import type {MatchResult} from '../matching/engine';
import type {NormalizedVehicle} from './normalize';
import type {PrivateMatch,PrivateNjkb,PrivateSource,UnifiedCompositionInput} from '../private-api/contracts';

export interface VehicleMatcher {match(vehicle:NormalizedVehicle,resolutionAsOf:string):Promise<MatchResult>}
export interface UnifiedVehicleComposition extends UnifiedCompositionInput {
 status:'vehicle_found';
 vehicleStatus:'found';
 record:BpadVehicleRecord;
 normalized:NormalizedBpadRecord;
 matchResult:MatchResult;
}
export type UnifiedVehicleLookupFailure=
 |{status:'invalid_request';vehicleStatus:null;njkbStatus:null;error:BpadError}
 |{status:'upstream_error';vehicleStatus:'upstream_error';njkbStatus:null;error:BpadError};
export type UnifiedVehicleLookupResult=UnifiedVehicleComposition|UnifiedVehicleLookupFailure;

const money=(value:number|null):string|null=>value===null?null:`${value}.00`;
const weight=(micros:number|null):string|null=>micros===null?null:`${Math.trunc(micros/1_000_000)}.${String(micros%1_000_000).padStart(6,'0')}`;
const publicMethod=(method:string):string=>method==='exact_code'?'exact_code_year_and_brand_type':method==='exact_identity'?'exact_brand_type_year_and_category':method;

function responseParts(result:MatchResult):{njkb:PrivateNjkb|null;match:PrivateMatch|null;source:PrivateSource|null} {
 if(result.status==='matched') return {njkb:{value:money(result.njkb),weight:weight(result.weight_micros),dpp_pkb:money(result.dpp_pkb)},
  match:{method:publicMethod(result.match_method),source_code:result.source.source_code},
  source:{regulation:result.source.regulation,pdf_page:result.source.pdf_page,source_row:result.source.row}};
 if(result.status==='conflict') return {njkb:null,match:{method:publicMethod(result.method),conflicts:[...result.conflicts]},source:null};
 if(result.status==='ambiguous') return {njkb:null,match:{method:publicMethod(result.method)},source:null};
 return {njkb:null,match:null,source:null};
}

export class UnifiedVehicleCompositionService {
 constructor(private readonly vehicles:FullVehicleProvider,private readonly matcher:VehicleMatcher) {}
 async composeRecord(record:BpadVehicleRecord,resolutionAsOf:string):Promise<UnifiedVehicleComposition> {
  const normalized=normalizeBpadRecord(record);const matchResult=await this.matcher.match(normalized.matching,resolutionAsOf);
  return {status:'vehicle_found',vehicleStatus:'found',njkbStatus:matchResult.status,record,normalized,matchResult,bpad:normalized,...responseParts(matchResult)};
 }
 async lookup(nopol:string,resolutionAsOf:string):Promise<UnifiedVehicleLookupResult> {
  try {return await this.composeRecord(await this.vehicles.getVehicleRecord(nopol),resolutionAsOf);}
  catch(error) {
   if(!(error instanceof BpadError))throw error;
   return error.code==='invalid_nopol'?{status:'invalid_request',vehicleStatus:null,njkbStatus:null,error}:
    {status:'upstream_error',vehicleStatus:'upstream_error',njkbStatus:null,error};
  }
 }
}
