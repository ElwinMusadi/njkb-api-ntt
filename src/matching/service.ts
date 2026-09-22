import { BpadError, normalizeNopol, type VehicleProvider } from '../bpad/adapter';
import { normalizeVehicle, type NormalizedVehicle } from '../vehicle/normalize';
import { NjkbMatchingEngine, type MatchResult } from './engine';

export type LookupResult=MatchResult
 | {status:'invalid_request';error:'invalid_nopol'}
 | {status:'upstream_error';error:'timeout'|'network_error'|'http_error'|'malformed_json'|'invalid_payload';http_status?:number};

export type DetailedLookupResult={
 result:LookupResult;
 context?:{nopol:string;vehicle:NormalizedVehicle};
};

export class NjkbLookupService {
 constructor(private vehicles:VehicleProvider,private matcher:NjkbMatchingEngine) {}
 async lookup(nopol:string,resolutionAsOf:string):Promise<LookupResult> {
  return (await this.lookupDetailed(nopol,resolutionAsOf)).result;
 }
 async lookupDetailed(nopol:string,resolutionAsOf:string):Promise<DetailedLookupResult> {
  try {
   const normalizedNopol=normalizeNopol(nopol);
   const vehicle=normalizeVehicle(await this.vehicles.getVehicle(normalizedNopol));
   return {result:await this.matcher.match(vehicle,resolutionAsOf),context:{nopol:normalizedNopol,vehicle}};
  }
  catch(error) {
   if(error instanceof BpadError) {
    if(error.code==='invalid_nopol') return {result:{status:'invalid_request',error:'invalid_nopol'}};
    return {result:{status:'upstream_error',error:error.code,...(error.httpStatus===undefined?{}:{http_status:error.httpStatus})}};
   }
   throw error;
  }
 }
}
