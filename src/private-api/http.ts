import {BpadError} from '../bpad/adapter';
import {DatabaseError,MatchingError} from '../errors';
import type {UnifiedVehicleLookupFailure,UnifiedVehicleLookupResult} from '../vehicle/composition';
import {privateError,type PrivateErrorResponse,shapeUnifiedVehicleResponse,type UnifiedVehicleResponse} from './contracts';
import type {GranularPrivateScope} from '../auth/contracts';

export type PrivateRouteResult=
 |{httpStatus:200;body:UnifiedVehicleResponse}
 |{httpStatus:400|500|502|503|504;body:PrivateErrorResponse};

export function privateRouteResult(result:UnifiedVehicleLookupResult,effectiveScopes:ReadonlySet<GranularPrivateScope>,requestId:string):PrivateRouteResult {
 if(result.status==='vehicle_found')return {httpStatus:200,body:shapeUnifiedVehicleResponse(result,effectiveScopes)};
 return privateFailure(result,requestId);
}
function privateFailure(result:UnifiedVehicleLookupFailure,requestId:string):PrivateRouteResult {
 if(result.status==='invalid_request')return {httpStatus:400,body:privateError('invalid_nopol','Format NOPOL tidak valid',requestId)};
 const status=result.error.code==='timeout'?504:502;
 return {httpStatus:status,body:privateError('upstream_error',result.error.code==='timeout'?'Layanan kendaraan BPAD melewati batas waktu':'Layanan kendaraan BPAD tidak tersedia',requestId)};
}
export function privateUnexpectedError(error:unknown,requestId:string):PrivateRouteResult {
 if(error instanceof BpadError) {
  const status=error.code==='invalid_nopol'?400:error.code==='timeout'?504:502;
  const code=error.code==='invalid_nopol'?'invalid_nopol':'upstream_error';
  return {httpStatus:status,body:privateError(code,error.code==='invalid_nopol'?'Format NOPOL tidak valid':error.code==='timeout'?'Layanan kendaraan BPAD melewati batas waktu':'Layanan kendaraan BPAD tidak tersedia',requestId)};
 }
 if(error instanceof DatabaseError)return {httpStatus:503,body:privateError('database_error','Database referensi NJKB tidak tersedia',requestId)};
 if(error instanceof MatchingError)return {httpStatus:500,body:privateError('internal_error','Proses matching NJKB gagal',requestId)};
 return {httpStatus:500,body:privateError('internal_error','Terjadi kesalahan internal',requestId)};
}
