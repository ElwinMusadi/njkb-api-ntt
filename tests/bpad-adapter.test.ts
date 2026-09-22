import { describe, expect, it, vi } from 'vitest';
import { BpadError, BpadVehicleAdapter } from '../src/bpad/adapter';
import { bpadPayload, jsonResponse } from './support';

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

 it('rejects a response missing required matching fields',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse({NOPOL:'DH4786PD',Merk:'HONDA'}));
  await expect(new BpadVehicleAdapter({fetch:fetchMock}).getVehicle('DH4786PD')).rejects.toMatchObject({code:'invalid_payload'});
  expect(fetchMock).toHaveBeenCalledOnce();
 });

 it('uses a stable error class for all adapter failures',()=>{
  expect(new BpadError('network_error','x')).toBeInstanceOf(Error);
 });
});
