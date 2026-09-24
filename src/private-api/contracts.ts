import type {BpadRawRecord} from '../bpad/types';
import type {NormalizedBpadRecord,PrivateAdministrative,PrivateOwner,PrivateRegistration,PrivateTax,PrivateVehicle} from '../bpad/normalize';
import type {GranularPrivateScope} from '../auth/contracts';

export type VehicleStatus='found'|'upstream_error';
export type UnifiedNjkbStatus='matched'|'not_found'|'reference_unavailable'|'conflict'|'ambiguous';
export interface PrivateNjkb {value:string|null;weight:string|null;dpp_pkb:string|null}
export interface PrivateMatch {method:string;source_code?:string;conflicts?:readonly string[]}
export interface PrivateSource {regulation:string;pdf_page:number;source_row:string}
export interface UnifiedCompositionInput {
 bpad:NormalizedBpadRecord;
 njkbStatus:UnifiedNjkbStatus;
 njkb:PrivateNjkb|null;
 match:PrivateMatch|null;
 source:PrivateSource|null;
}
export interface UnifiedVehicleResponse {
 status:'vehicle_found';vehicle_status:'found';njkb_status:UnifiedNjkbStatus;nopol:string;
 vehicle:PrivateVehicle;
 registration?:PrivateRegistration;tax?:PrivateTax;owner?:PrivateOwner;administrative?:PrivateAdministrative;
 bpad:{code:string|null;status:string|null;message:string|null;raw?:Readonly<BpadRawRecord>};
 njkb?:PrivateNjkb|null;match?:PrivateMatch|null;source?:PrivateSource|null;
}

export function shapeUnifiedVehicleResponse(input:UnifiedCompositionInput,effectiveScopes:ReadonlySet<GranularPrivateScope>):UnifiedVehicleResponse {
 if(!effectiveScopes.has('vehicle:read')) throw new Error('vehicle:read scope is required to shape a unified vehicle response');
 const {chassis_number,engine_number,plate_color,...basicVehicle}=input.bpad.vehicle;
 const vehicle=effectiveScopes.has('registration:read')?{...basicVehicle,chassis_number,engine_number,plate_color}:basicVehicle;
 const result:UnifiedVehicleResponse={status:'vehicle_found',vehicle_status:'found',njkb_status:input.njkbStatus,nopol:input.bpad.nopol,vehicle,
  bpad:{code:input.bpad.bpad.code,status:input.bpad.bpad.status,message:input.bpad.bpad.message}};
 if(effectiveScopes.has('registration:read')) {result.registration=input.bpad.registration;result.administrative=input.bpad.administrative;}
 if(effectiveScopes.has('tax:read')) result.tax=input.bpad.tax;
 if(effectiveScopes.has('owner:read')) result.owner=input.bpad.owner;
 if(effectiveScopes.has('bpad:raw')) result.bpad.raw=input.bpad.bpad.raw;
 if(effectiveScopes.has('njkb:read')) {result.njkb=input.njkb;result.match=input.match;result.source=input.source;}
 return result;
}

export type PrivateErrorCode='invalid_nopol'|'unsupported_query_parameter'|'unauthorized'|'forbidden'|'rate_limit_exceeded'|'upstream_error'|'database_error'|'internal_error';
export interface PrivateErrorResponse {status:'invalid_request'|'unauthorized'|'forbidden'|'rate_limit_exceeded'|'upstream_error'|'error';vehicle_status?:'upstream_error';njkb_status?:null;error:{code:PrivateErrorCode;message:string;request_id:string}}
export function privateError(code:PrivateErrorCode,message:string,requestId:string):PrivateErrorResponse {
 const status=code==='unauthorized'?'unauthorized':code==='forbidden'?'forbidden':code==='rate_limit_exceeded'?'rate_limit_exceeded':code==='upstream_error'?'upstream_error':code==='database_error'||code==='internal_error'?'error':'invalid_request';
 return code==='upstream_error'?{status,vehicle_status:'upstream_error',njkb_status:null,error:{code,message,request_id:requestId}}:{status,error:{code,message,request_id:requestId}};
}
