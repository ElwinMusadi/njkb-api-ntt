import {parseBpadVehicleRecord,type BpadVehicleRecord} from './types';

export const BPAD_VEHICLE_URL='https://dash.bpad.nttprov.go.id/pajak/webdtd/pendataan/core/php/getnopol.php';
export const DEFAULT_BPAD_MAX_RESPONSE_BYTES=256*1024;

export type BpadErrorCode='invalid_nopol'|'timeout'|'network_error'|'http_error'|'malformed_json'|'invalid_payload';
export class BpadError extends Error {
 constructor(public readonly code:BpadErrorCode,message:string,public readonly httpStatus?:number){super(message);this.name='BpadError';}
}
export interface BpadVehicle {
 nopol:string; vehicleCategory:string; brand:string; brandCode:string;
 type:string; typeCode:string; vehicleYear:number;
}
export interface VehicleProvider { getVehicle(nopol:string):Promise<BpadVehicle>; }
export interface FullVehicleProvider { getVehicleRecord(nopol:string):Promise<BpadVehicleRecord>; }
export type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

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
async function readWithAbort(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw new BpadError('timeout','BPAD API melewati batas waktu');
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new BpadError('timeout','BPAD API melewati batas waktu'));
  signal.addEventListener('abort',abort,{once:true});
  reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
async function readBoundedJson(response:Response,signal:AbortSignal,maxBytes:number):Promise<unknown> {
 const advertised=response.headers.get('content-length');
 if(advertised!==null&&/^\d+$/.test(advertised)&&Number(advertised)>maxBytes)
  throw new BpadError('invalid_payload','BPAD API mengembalikan payload terlalu besar');
 if(response.body===null) throw new BpadError('malformed_json','BPAD API mengembalikan JSON tidak valid');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try {
  while(true) {
   const {done,value}=await readWithAbort(reader,signal);if(done)break;if(value===undefined)continue;
   size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new BpadError('invalid_payload','BPAD API mengembalikan payload terlalu besar');}
   chunks.push(value);
  }
 } catch(error) {
  if(error instanceof BpadError){await reader.cancel().catch(()=>undefined);throw error;}
  if(signal.aborted||(error instanceof DOMException&&error.name==='AbortError'))throw new BpadError('timeout','BPAD API melewati batas waktu');
  throw new BpadError('network_error','BPAD API tidak dapat dihubungi');
 }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}
 catch{throw new BpadError('malformed_json','BPAD API mengembalikan JSON tidak valid');}
}
function matchingVehicle(record:BpadVehicleRecord):BpadVehicle {
 const value=record.matching;
 return {nopol:value.NOPOL,vehicleCategory:value.JenisKendaraan,brand:value.Merk,brandCode:value.KD_MERK,
  type:value.Type,typeCode:value.KD_TIPE,vehicleYear:value.TahunPembuatan};
}

export class BpadVehicleAdapter implements VehicleProvider,FullVehicleProvider {
 constructor(private options:{fetch?:Fetcher;timeoutMs?:number;endpoint?:string;retryDelayMs?:number;maxResponseBytes?:number}={}){}
 async getVehicle(nopolInput:string):Promise<BpadVehicle> {return matchingVehicle(await this.getVehicleRecord(nopolInput));}
 async getVehicleRecord(nopolInput:string):Promise<BpadVehicleRecord> {
  const nopol=normalizeNopol(nopolInput);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.options.timeoutMs??5000);
  try {
   const fetcher=this.options.fetch??fetch;let response:Response;
   for(let attempt=0;;attempt++) {
    try {
     response=await fetcher(this.options.endpoint??BPAD_VEHICLE_URL,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({nopol}),signal:controller.signal});break;
    } catch(error) {
     if(controller.signal.aborted||(error instanceof DOMException&&error.name==='AbortError'))throw new BpadError('timeout','BPAD API melewati batas waktu');
     if(attempt>=1)throw new BpadError('network_error','BPAD API tidak dapat dihubungi');
     await new Promise<void>(resolve=>setTimeout(resolve,this.options.retryDelayMs??300));
     if(controller.signal.aborted)throw new BpadError('timeout','BPAD API melewati batas waktu');
    }
   }
   if(!response.ok)throw new BpadError('http_error',`BPAD API mengembalikan HTTP ${response.status}`,response.status);
   const body=await readBoundedJson(response,controller.signal,this.options.maxResponseBytes??DEFAULT_BPAD_MAX_RESPONSE_BYTES);
   try{return parseBpadVehicleRecord(unwrapPayload(body));}
   catch(error){if(error instanceof BpadError)throw error;throw new BpadError('invalid_payload','BPAD API tidak memiliki field kendaraan wajib');}
  } finally {clearTimeout(timeout);}
 }
}
