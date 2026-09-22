import type { NormalizedVehicle } from '../vehicle/normalize';
import type { LookupResult } from '../matching/service';

export type PublicStatusCode=200|400|404|409|502|504;

function publicVehicle(vehicle:NormalizedVehicle) {
 return {brand:vehicle.brand,type:vehicle.type,year:vehicle.vehicleYear};
}
function rupiah(value:number|null):string|null {
 return value===null?null:`${value}.00`;
}
function weight(value:number|null):string|null {
 if(value===null) return null;
 return `${Math.trunc(value/1_000_000)}.${String(value%1_000_000).padStart(6,'0')}`;
}
function publicMethod(method:string):string {
 if(method==='exact_code') return 'exact_code_year_and_brand_type';
 if(method==='exact_identity') return 'exact_brand_type_year_and_category';
 return method;
}
function upstreamMessage(code:string):string {
 if(code==='timeout') return 'Layanan kendaraan BPAD melewati batas waktu';
 if(code==='http_error') return 'Layanan kendaraan BPAD sedang tidak tersedia';
 if(code==='malformed_json'||code==='invalid_payload') return 'Respons layanan kendaraan BPAD tidak valid';
 return 'Layanan kendaraan BPAD tidak dapat dihubungi';
}

export function formatLookupResponse(input:{
 result:LookupResult; nopol:string; vehicle?:NormalizedVehicle; requestId:string;
}):{body:Record<string,unknown>;status:PublicStatusCode} {
 const {result,nopol,vehicle,requestId}=input;
 if(result.status==='invalid_request') return {status:400,body:{status:'invalid_request',error:{code:'invalid_nopol',message:'Format NOPOL tidak valid',request_id:requestId}}};
 if(result.status==='upstream_error') return {status:result.error==='timeout'?504:502,body:{
  status:'upstream_error',nopol,
  error:{code:result.error,message:upstreamMessage(result.error),request_id:requestId}
 }};
 if(!vehicle) throw new Error('Vehicle context missing for match result');
 const base={nopol,vehicle:publicVehicle(vehicle)};
 if(result.status==='matched') return {status:200,body:{status:'matched',...base,
  njkb:{value:rupiah(result.njkb),weight:weight(result.weight_micros),dpp_pkb:rupiah(result.dpp_pkb)},
  match:{method:publicMethod(result.match_method),source_code:result.source.source_code},
  source:{regulation:result.source.regulation,pdf_page:result.source.pdf_page,source_row:result.source.row}
 }};
 if(result.status==='reference_unavailable') return {status:200,body:{status:result.status,...base}};
 if(result.status==='not_found') return {status:404,body:{status:'not_found',...base}};
 if(result.status==='ambiguous') return {status:409,body:{status:'ambiguous',...base,match:{method:publicMethod(result.method)}}};
 return {status:409,body:{status:'conflict',...base,match:{method:publicMethod(result.method),conflicts:result.conflicts}}};
}
