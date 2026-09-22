import { z } from 'zod';

export const BPAD_VEHICLE_URL='https://dash.bpad.nttprov.go.id/pajak/webdtd/pendataan/core/php/getnopol.php';

export type BpadErrorCode='invalid_nopol'|'timeout'|'network_error'|'http_error'|'malformed_json'|'invalid_payload';
export class BpadError extends Error {
 constructor(public readonly code:BpadErrorCode,message:string,public readonly httpStatus?:number){super(message);this.name='BpadError';}
}
export interface BpadVehicle {
 nopol:string; vehicleCategory:string; brand:string; brandCode:string;
 type:string; typeCode:string; vehicleYear:number;
}
export interface VehicleProvider { getVehicle(nopol:string):Promise<BpadVehicle>; }
export type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

const requiredString=z.union([z.string(),z.number()]).transform(v=>String(v).trim()).pipe(z.string().min(1));
const upstreamVehicle=z.object({
 NOPOL:requiredString,JenisKendaraan:requiredString,Merk:requiredString,KD_MERK:requiredString,
 Type:requiredString,KD_TIPE:requiredString,TahunPembuatan:z.coerce.number().int().min(1900).max(2200)
}).passthrough();

export function normalizeNopol(input:string):string {
 const normalized=input.normalize('NFKC').toUpperCase().replace(/[\s-]+/g,'');
 if(!/^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$/.test(normalized)) throw new BpadError('invalid_nopol','Format NOPOL tidak valid');
 return normalized;
}
function unwrapPayload(value:unknown):unknown {
 if(Array.isArray(value)) return value.length===1?value[0]:value;
 if(value && typeof value==='object' && 'data' in value) {
  const data=(value as {data:unknown}).data;
  return Array.isArray(data) && data.length===1?data[0]:data;
 }
 return value;
}
export class BpadVehicleAdapter implements VehicleProvider {
 constructor(private options:{fetch?:Fetcher;timeoutMs?:number;endpoint?:string;retryDelayMs?:number}={}){}
 async getVehicle(nopolInput:string):Promise<BpadVehicle> {
  const nopol=normalizeNopol(nopolInput);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),this.options.timeoutMs??5000);
  let response:Response;
  try {
   const fetcher=this.options.fetch??fetch;
   for(let attempt=0;;attempt++) {
    try {
     response=await fetcher(this.options.endpoint??BPAD_VEHICLE_URL,{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({nopol}),signal:controller.signal
     });
     break;
    } catch(error) {
     if(controller.signal.aborted || (error instanceof DOMException && error.name==='AbortError'))
      throw new BpadError('timeout','BPAD API melewati batas waktu');
     if(attempt>=1) throw new BpadError('network_error','BPAD API tidak dapat dihubungi');
     await new Promise<void>(resolve=>setTimeout(resolve,this.options.retryDelayMs??300));
     if(controller.signal.aborted) throw new BpadError('timeout','BPAD API melewati batas waktu');
    }
   }
  } finally {clearTimeout(timeout);}
  if(!response.ok) throw new BpadError('http_error',`BPAD API mengembalikan HTTP ${response.status}`,response.status);
  let body:unknown;
  try {body=await response.json();} catch {throw new BpadError('malformed_json','BPAD API mengembalikan JSON tidak valid');}
  const parsed=upstreamVehicle.safeParse(unwrapPayload(body));
  if(!parsed.success) throw new BpadError('invalid_payload','BPAD API tidak memiliki field kendaraan wajib');
  const v=parsed.data;
  return {nopol:v.NOPOL,vehicleCategory:v.JenisKendaraan,brand:v.Merk,brandCode:v.KD_MERK,
   type:v.Type,typeCode:v.KD_TIPE,vehicleYear:v.TahunPembuatan};
 }
}
