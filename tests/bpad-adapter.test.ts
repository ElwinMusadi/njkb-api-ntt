import { describe, expect, it, vi } from 'vitest';
import { BpadError, BpadVehicleAdapter } from '../src/bpad/adapter';
import { bpadPayload, jsonResponse } from './support';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';

describe('BPAD vehicle adapter',()=>{
 it('posts normalized NOPOL and returns only matching fields',async()=>{
  const fetchMock=vi.fn(async (_input:RequestInfo|URL,init?:RequestInit)=>jsonResponse(bpadPayload));
  const vehicle=await new BpadVehicleAdapter({fetch:fetchMock}).getVehicle('dh 4786-pd');
  expect(fetchMock).toHaveBeenCalledOnce();
  const [,init]=fetchMock.mock.calls[0];
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({nopol:'DH4786PD'});
  expect(vehicle).toEqual({nopol:'DH4786PD',vehicleCategory:'SEPEDA MOTOR',brand:'HONDA',brandCode:'167',type:'C1M02N42L1 A/T',typeCode:'701167 08549',vehicleYear:2024});
  expect(vehicle).not.toHaveProperty('NamaPemilik');
  expect(vehicle).not.toHaveProperty('NoRangka');
 });

 it('returns a full immutable BPAD record while preserving getVehicle compatibility',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(syntheticFullBpadRecord));const adapter=new BpadVehicleAdapter({fetch:fetchMock});
  const record=await adapter.getVehicleRecord('zz 0001-zz');
  expect(record.raw).toEqual(syntheticFullBpadRecord);expect(Object.isFrozen(record.raw)).toBe(true);expect(record.raw.FutureBpadFieldExample).toBe('synthetic-value');
  expect(record.matching).toEqual({NOPOL:'ZZ0001ZZ',JenisKendaraan:'MINIBUS',Merk:'HONDA',KD_MERK:'167',Type:'HONDA MOBILIO DD4 1.5 S MT CKD',KD_TIPE:'103167 40649',TahunPembuatan:2019});
  expect(record.meta).toEqual({code:'1',status:'success',message:'SYNTHETIC TEST RESPONSE'});
  expect(await adapter.getVehicle('ZZ0001ZZ')).toEqual({nopol:'ZZ0001ZZ',vehicleCategory:'MINIBUS',brand:'HONDA',brandCode:'167',type:'HONDA MOBILIO DD4 1.5 S MT CKD',typeCode:'103167 40649',vehicleYear:2019});
 });

 it.each([
  ['single-element array',[syntheticFullBpadRecord]],
  ['data object',{data:syntheticFullBpadRecord}],
  ['data single-element array',{data:[syntheticFullBpadRecord]}]
 ])('unwraps %s into the same full record',async(_label,payload)=>{
  const record=await new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(payload))}).getVehicleRecord('ZZ0001ZZ');
  expect(record.raw.NOPOL).toBe('ZZ0001ZZ');expect(record.raw.FutureBpadFieldExample).toBe('synthetic-value');
 });

 it('rejects multiple records without selecting one arbitrarily',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse([syntheticFullBpadRecord,syntheticFullBpadRecord]));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicleRecord('ZZ0001ZZ')).rejects.toMatchObject({code:'invalid_payload'});
 });

 it('allows optional PII fields to be absent while retaining required matching validation',async()=>{
  const {NamaPemilik,Alamat,NoKTP,NoBPKB,NoRangka,NoMesin,...withoutOptionalPii}=syntheticFullBpadRecord;
  const record=await new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(withoutOptionalPii))}).getVehicleRecord('ZZ0001ZZ');
  expect(record.matching.KD_TIPE).toBe('103167 40649');expect(record.raw).not.toHaveProperty('NamaPemilik');
 });

 it('rejects metadata-only degraded payload as invalid_payload',async()=>{
  const payload={kode:'0',status:'error',pesan:'SYNTHETIC DEGRADED RESPONSE'};
  await expect(new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(payload))}).getVehicleRecord('ZZ0001ZZ')).rejects.toMatchObject({code:'invalid_payload'});
 });

 it('accepts payload below response limit and rejects oversized payload without exposing its body',async()=>{
  const body=JSON.stringify(syntheticFullBpadRecord);const safe=new Response(body,{headers:{'content-type':'application/json'}});
  await expect(new BpadVehicleAdapter({fetch:vi.fn(async()=>safe),maxResponseBytes:body.length+1}).getVehicleRecord('ZZ0001ZZ')).resolves.toMatchObject({meta:{status:'success'}});
  const secret='TEST OWNER TEST ADDRESS TEST-KTP';const oversized=new Response(JSON.stringify({...syntheticFullBpadRecord,FutureBpadFieldExample:secret.repeat(100)}),{headers:{'content-type':'application/json'}});
  let error:unknown;try{await new BpadVehicleAdapter({fetch:vi.fn(async()=>oversized),maxResponseBytes:128}).getVehicleRecord('ZZ0001ZZ');}catch(value){error=value;}
  expect(error).toBeInstanceOf(BpadError);expect(error).toMatchObject({code:'invalid_payload'});expect((error as BpadError).message).not.toContain(secret);
 });

 it('rejects advertised oversized content before reading the body',async()=>{
  const response=new Response(JSON.stringify(syntheticFullBpadRecord),{headers:{'content-type':'application/json','content-length':'999999'}});
  await expect(new BpadVehicleAdapter({fetch:vi.fn(async()=>response),maxResponseBytes:1024}).getVehicleRecord('ZZ0001ZZ')).rejects.toMatchObject({code:'invalid_payload'});
 });

 it('enforces the total timeout while reading a stalled response body',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(){/* intentionally stalled */}});const response=new Response(stream,{headers:{'content-type':'application/json'}});
  await expect(new BpadVehicleAdapter({fetch:vi.fn(async()=>response),timeoutMs:5}).getVehicleRecord('ZZ0001ZZ')).rejects.toMatchObject({code:'timeout'});
 });

 it('never logs raw BPAD PII for success or adapter failures',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
   await new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(syntheticFullBpadRecord))}).getVehicleRecord('ZZ0001ZZ');
   await new BpadVehicleAdapter({fetch:vi.fn(async()=>new Response('{broken'))}).getVehicleRecord('ZZ0001ZZ').catch(()=>undefined);
   expect(JSON.stringify([...log.mock.calls,...error.mock.calls])).not.toMatch(/TEST OWNER|TEST ADDRESS|9999999999999999|TEST-BPKB|TEST-CHASSIS|TEST-ENGINE/);
  } finally {log.mockRestore();error.mockRestore();}
 });

 it('rejects invalid NOPOL before calling upstream',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(bpadPayload));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicle('../bad')).rejects.toMatchObject({code:'invalid_nopol'});
  expect(fetchMock).not.toHaveBeenCalled();
 });

 it('classifies a timeout',async()=>{
  const fetchMock=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
   init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));
  }));
  await expect(new BpadVehicleAdapter({fetch:fetchMock,timeoutMs:5}).getVehicle('DH4786PD')).rejects.toMatchObject({code:'timeout'});
  expect(fetchMock).toHaveBeenCalledOnce();
 });

 it('retries one transient network failure and succeeds on the second attempt',async()=>{
  const fetchMock=vi.fn()
   .mockRejectedValueOnce(new TypeError('connection reset'))
   .mockResolvedValueOnce(jsonResponse(bpadPayload));
  const vehicle=await new BpadVehicleAdapter({fetch:fetchMock,retryDelayMs:0}).getVehicle('DH4786PD');
  expect(vehicle.typeCode).toBe('701167 08549');
  expect(fetchMock).toHaveBeenCalledTimes(2);
 });

 it('stops after two network attempts when both fail',async()=>{
  const fetchMock=vi.fn().mockRejectedValue(new TypeError('connection reset'));
  await expect(new BpadVehicleAdapter({fetch:fetchMock,retryDelayMs:0}).getVehicle('DH4786PD')).rejects.toMatchObject({code:'network_error'});
  expect(fetchMock).toHaveBeenCalledTimes(2);
 });

 it('classifies an HTTP error without retrying',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse({error:'down'},503));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicle('DH4786PD')).rejects.toMatchObject({code:'http_error',httpStatus:503});
  expect(fetchMock).toHaveBeenCalledOnce();
 });

 it('classifies malformed JSON',async()=>{
  const fetchMock=vi.fn(async()=>new Response('{broken',{status:200,headers:{'content-type':'application/json'}}));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicle('DH4786PD')).rejects.toMatchObject({code:'malformed_json'});
  expect(fetchMock).toHaveBeenCalledOnce();
 });

 it.each(['NOPOL','JenisKendaraan','Merk','KD_MERK','Type','KD_TIPE','TahunPembuatan'] as const)('rejects required matching field %s when absent',async field=>{
  const payload:Record<string,unknown>={...syntheticFullBpadRecord};delete payload[field];const fetchMock=vi.fn(async()=>jsonResponse(payload));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicleRecord('ZZ0001ZZ')).rejects.toMatchObject({code:'invalid_payload'});
  expect(fetchMock).toHaveBeenCalledOnce();
 });

 it('preserves and deeply freezes unknown future JSON-compatible structures',async()=>{
  const future={flags:['synthetic',{nested:'value'}]};const payload={...syntheticFullBpadRecord,FutureBpadFieldExample:future};
  const record=await new BpadVehicleAdapter({fetch:vi.fn(async()=>jsonResponse(payload))}).getVehicleRecord('ZZ0001ZZ');
  expect(record.raw.FutureBpadFieldExample).toEqual(future);expect(Object.isFrozen(record.raw.FutureBpadFieldExample)).toBe(true);
  expect(Object.isFrozen((record.raw.FutureBpadFieldExample as {flags:unknown[]}).flags)).toBe(true);
 });

 it('uses a stable error class for all adapter failures',()=>{
  expect(new BpadError('network_error','x')).toBeInstanceOf(Error);
 });
});
