import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Miniflare} from 'miniflare';
import fixture from '../fixtures/verified.json';
import openapi from '../docs/openapi.json';
import {importDataset} from '../src/db/import';
import {NjkbRepository} from '../src/db/repository';
import {createApp,type Bindings,type SafeLogger} from '../src/index';
import {NjkbMatchingEngine} from '../src/matching/engine';
import {bpadPayload,createEmptyTestDatabase,createTestDatabase,jsonResponse} from './support';

const bpad2025={...bpadPayload,NOPOL:'DH2025AA',TahunPembuatan:2025};
const bpad2026={...bpadPayload,NOPOL:'DH2026ZZ',KD_TIPE:'701167 67749',TahunPembuatan:2026};
const logger:SafeLogger={info:vi.fn(),error:vi.fn()};
let mf:Miniflare,db:D1Database;
const bindings=():Bindings=>({NJKB_DB:db,BPAD_TIMEOUT_MS:'100',NJKB_RESOLUTION_AS_OF:'2026-09-20'});
const call=async(payload:unknown,url:string,status=200,options:Parameters<typeof createApp>[0]={})=>{
 const app=createApp({fetch:vi.fn(async()=>jsonResponse(payload,status)),logger,...options});
 const response=await app.request(url,{},bindings());
 return {response,body:await response.json() as Record<string,unknown>};
};
const sortedKeys=(value:unknown)=>Object.keys(value as Record<string,unknown>).sort();

beforeEach(async()=>{({mf,db}=await createTestDatabase());vi.clearAllMocks();});
afterEach(async()=>{await mf.dispose();});

describe('Phase 9 public contract — success and regulatory boundaries',()=>{
 it.each([
  {label:'2024',payload:bpadPayload,url:'http://local/api/njkb/DH4786PD',year:2024,value:'12500000.00',regulation:'Pergub NTT No. 26 Tahun 2025'},
  {label:'2025',payload:bpad2025,url:'http://local/api/njkb/DH2025AA',year:2025,value:'12600000.00',regulation:'Pergub NTT No. 26 Tahun 2025'},
  {label:'2026',payload:bpad2026,url:'http://local/api/njkb/DH2026ZZ',year:2026,value:'12900000.00',regulation:'Permendagri No. 11 Tahun 2026'}
 ])('freezes matched $label response shape and decimal strings',async({payload,url,year,value,regulation})=>{
  const {response,body}=await call(payload,url);
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');
  expect(sortedKeys(body)).toEqual(['match','njkb','nopol','source','status','vehicle']);
  expect(sortedKeys(body.vehicle)).toEqual(['brand','type','year']);
  expect(sortedKeys(body.njkb)).toEqual(['dpp_pkb','value','weight']);
  expect(sortedKeys(body.match)).toEqual(['method','source_code']);
  expect(sortedKeys(body.source)).toEqual(['pdf_page','regulation','source_row']);
  expect(body).toMatchObject({status:'matched',vehicle:{year},njkb:{value},source:{regulation}});
  const njkb=body.njkb as Record<string,unknown>;
  expect(njkb.value).toMatch(/^\d+\.00$/);expect(njkb.weight).toMatch(/^\d+\.\d{6}$/);expect(njkb.dpp_pkb).toMatch(/^\d+\.00$/);
  expect(JSON.stringify(body)).not.toMatch(/NamaPemilik|Alamat|NoRangka|NoMesin|NoKTP|NomorTelepon|tax_year|edition_id|reference_id|document_sha256|PRIVATE/);
 });

 it('normalizes lowercase, whitespace, and hyphens to the canonical NOPOL',async()=>{
  const {response,body}=await call(bpadPayload,'http://local/api/njkb/dh-4786-pd');
  expect(response.status).toBe(200);expect(body.nopol).toBe('DH4786PD');
 });
});

describe('Phase 9 public contract — consumer-visible outcomes',()=>{
 it('freezes not_found HTTP 404 without NJKB/source internals',async()=>{
  const {response,body}=await call({...bpad2026,Merk:'SUZUKI',KD_MERK:'SZK',Type:'GSX_UNKNOWN',KD_TIPE:'ZZZZ'},'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(404);expect(body).toEqual({status:'not_found',nopol:'DH2026ZZ',vehicle:{brand:'SUZUKI',type:'GSX_UNKNOWN',year:2026}});
 });

 it('freezes conflict HTTP 409 and exposes only conflict field names',async()=>{
  await db.prepare("UPDATE njkb_references SET brand='YAMAHA',brand_normalized='YAMAHA' WHERE id='fixture-b'").run();
  const {response,body}=await call(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(409);expect(body).toEqual({status:'conflict',nopol:'DH2026ZZ',vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2026},match:{method:'exact_code_year_and_brand_type',conflicts:['brand']}});
 });

 it('freezes ambiguous HTTP 409 without candidate values',async()=>{
  const data=structuredClone(fixture);data.njkb_references=[{...data.njkb_references[4],id:'contract-duplicate',source_row:'312'}];await importDataset(db,data);
  const {response,body}=await call(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(409);expect(body).toEqual({status:'ambiguous',nopol:'DH2026ZZ',vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2026},match:{method:'exact_code_year_and_brand_type'}});
 });

 it('freezes reference_unavailable as HTTP 200 without NJKB/match/source',async()=>{
  await mf.dispose();({mf,db}=await createEmptyTestDatabase());
  const {response,body}=await call({...bpad2026,TahunPembuatan:2027},'http://local/api/njkb/DH2027ZZ');
  expect(response.status).toBe(200);expect(body).toEqual({status:'reference_unavailable',nopol:'DH2027ZZ',vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2027}});
 });

 it('freezes invalid_nopol and unsupported query error envelopes',async()=>{
  for(const item of [
   {url:'http://local/api/njkb/INVALID',code:'invalid_nopol'},
   {url:'http://local/api/njkb/DH4786PD?tax_year=2025',code:'unsupported_query_parameter'}
  ]) {
   const {response,body}=await call(bpadPayload,item.url);expect(response.status).toBe(400);
   expect(sortedKeys(body)).toEqual(['error','status']);expect(body.status).toBe('invalid_request');
   expect(body.error).toMatchObject({code:item.code,request_id:response.headers.get('x-request-id')});
  }
 });

 it('freezes upstream HTTP 502 envelope and request correlation',async()=>{
  const {response,body}=await call({message:'down'},'http://local/api/njkb/DH4786PD',503);
  expect(response.status).toBe(502);expect(body).toMatchObject({status:'upstream_error',nopol:'DH4786PD',error:{code:'http_error',request_id:response.headers.get('x-request-id')}});
  expect(sortedKeys(body)).toEqual(['error','nopol','status']);
 });

 it('freezes database and matching internal error envelopes without causes',async()=>{
  const failingDb={prepare(){throw new Error('secret SQL');}} as unknown as D1Database;
  const dbApp=createApp({fetch:vi.fn(async()=>jsonResponse(bpad2026)),logger});
  const dbResponse=await dbApp.request('http://local/api/njkb/DH2026ZZ',{},{...bindings(),NJKB_DB:failingDb});
  const dbBody=await dbResponse.json() as Record<string,unknown>;
  expect(dbResponse.status).toBe(503);expect(dbBody).toMatchObject({status:'error',error:{code:'database_error'}});expect(JSON.stringify(dbBody)).not.toContain('secret SQL');
  const broken={approvedEditions:async()=>{throw new Error('secret matcher');}} as unknown as NjkbRepository;
  const matching=await call(bpad2026,'http://local/api/njkb/DH2026ZZ',200,{matcherFactory:()=>new NjkbMatchingEngine(broken)});
  expect(matching.response.status).toBe(500);expect(matching.body).toMatchObject({status:'error',error:{code:'matching_error'}});expect(JSON.stringify(matching.body)).not.toContain('secret matcher');
 });

 it('freezes HTTP 429 body and Retry-After header',async()=>{
  const result=await call(bpadPayload,'http://local/api/njkb/DH4786PD',200,{rateLimiter:{check:()=>({allowed:false,retryAfterSeconds:9})}});
  expect(result.response.status).toBe(429);expect(result.response.headers.get('retry-after')).toBe('9');
  expect(result.body).toMatchObject({status:'invalid_request',error:{code:'rate_limit_exceeded',request_id:result.response.headers.get('x-request-id')}});
 });
});

describe('Phase 9 header, request ID, and OpenAPI contract',()=>{
 it('uses server-generated request IDs and intended security headers on all representative classes',async()=>{
  const app=createApp({fetch:vi.fn(async()=>jsonResponse(bpadPayload)),logger});
  for(const request of [
   new Request('http://local/health',{headers:{'X-Request-ID':'client-controlled'}}),
   new Request('http://local/api/njkb/INVALID',{headers:{'X-Request-ID':'client-controlled'}}),
   new Request('http://local/api/njkb/DH4786PD',{headers:{'X-Request-ID':'client-controlled'}})
  ]) {
   const response=await app.request(request,{},bindings());
   expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);expect(response.headers.get('x-request-id')).not.toBe('client-controlled');
   expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
   expect(response.headers.get('x-frame-options')).toBe('DENY');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
   expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
   expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
   expect(response.headers.get('access-control-allow-origin')).toBeNull();
  }
 });

 it('publishes valid OpenAPI JSON with exact supported routes, statuses, schemas, and no internal identifiers',()=>{
  expect(openapi.openapi).toBe('3.1.0');expect(openapi.servers[0].url).toBe('https://njkb-api-ntt.elwinmusadi.workers.dev');
  expect(Object.keys(openapi.paths).sort()).toEqual(['/api/njkb/{nopol}','/health','/ready']);
  expect(Object.keys(openapi.paths['/api/njkb/{nopol}'])).toEqual(['get']);
  expect(Object.keys(openapi.paths['/api/njkb/{nopol}'].get.responses).sort()).toEqual(['200','400','404','409','429','500','502','503','504']);
  const serialized=JSON.stringify(openapi);
  expect(serialized).not.toMatch(/database_id|edition_id|reference_id|document_sha256|owner|NamaPemilik|NoRangka|NoMesin/);
  expect(openapi.components.schemas.MatchedResponse.required).toEqual(['status','nopol','vehicle','njkb','match','source']);
  expect(openapi.components.schemas.Njkb.properties.value.type).toEqual(['string','null']);
 });
});
