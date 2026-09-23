import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Miniflare } from 'miniflare';
import fixture from '../fixtures/verified.json';
import { importDataset } from '../src/db/import';
import { NjkbRepository } from '../src/db/repository';
import { createApp, type Bindings, type SafeLogger } from '../src/index';
import { NjkbMatchingEngine } from '../src/matching/engine';
import { bpadMobilio2019, bpadPayload, createTestDatabase, jsonResponse, seedMobilio2019 } from './support';

const bpad2026={...bpadPayload,NOPOL:'DH2026ZZ',KD_TIPE:'701167 67749',TahunPembuatan:2026};
const bpad2025={...bpadPayload,NOPOL:'DH2025AA',TahunPembuatan:2025};
let mf:Miniflare,db:D1Database;
const logger:SafeLogger={info:vi.fn(),error:vi.fn()};
const bindings=()=>({NJKB_DB:db,BPAD_TIMEOUT_MS:'100',NJKB_RESOLUTION_AS_OF:'2026-09-20'} satisfies Bindings);
const request=async(payload:unknown,url:string,status=200)=>{
 const fetchMock=vi.fn(async()=>jsonResponse(payload,status));
 const app=createApp({fetch:fetchMock,logger});
 const response=await app.request(url,{},bindings());
 return {response,json:await response.json() as Record<string,unknown>,fetchMock};
};

beforeEach(async()=>{({mf,db}=await createTestDatabase());vi.clearAllMocks();});
afterEach(async()=>{await mf.dispose();});

describe('Phase 8B operational endpoints and middleware',()=>{
 it('serves lightweight health without BPAD or D1 query',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(bpadPayload));
  const dbProbe={prepare:vi.fn()} as unknown as D1Database;
  const app=createApp({fetch:fetchMock,logger});
  const response=await app.request('http://local/health',{}, {...bindings(),NJKB_DB:dbProbe});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'ok'});
  expect(fetchMock).not.toHaveBeenCalled();expect((dbProbe as unknown as {prepare:ReturnType<typeof vi.fn>}).prepare).not.toHaveBeenCalled();
 });
 it('reports ready after one lightweight D1 probe',async()=>{
  const app=createApp({logger});const response=await app.request('http://local/ready',{},bindings());
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'ready'});
 });
 it('returns safe HTTP 503 when readiness D1 probe fails',async()=>{
  const failingDb={prepare(){throw new Error('sensitive SQL path');}} as unknown as D1Database;
  const app=createApp({logger});const response=await app.request('http://local/ready',{},{...bindings(),NJKB_DB:failingDb});
  const json=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(503);expect(json).toMatchObject({status:'unhealthy',error:{code:'database_unavailable'}});
  expect(JSON.stringify(json)).not.toContain('sensitive SQL path');
 });
 it('sets security, no-store, and request ID headers on health and client errors',async()=>{
  for(const url of ['http://local/health','http://local/api/njkb/INVALID']) {
   const {response}=await request(bpadPayload,url);
   expect(response.headers.get('cache-control')).toBe('no-store');
   expect(response.headers.get('x-request-id')).toBeTruthy();
   expect(response.headers.get('x-content-type-options')).toBe('nosniff');
   expect(response.headers.get('x-frame-options')).toBe('DENY');
   expect(response.headers.get('referrer-policy')).toBe('no-referrer');
   expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
   expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  }
 });
 it('allows requests below the isolate limit and keeps client keys isolated',async()=>{
  const decisions=new Map<string,number>();
  const rateLimiter={check:vi.fn((key:string)=>{const count=(decisions.get(key)??0)+1;decisions.set(key,count);return {allowed:count<=2,retryAfterSeconds:count<=2?0:60}})};
  const fetchMock=vi.fn(async()=>jsonResponse(bpadPayload));const app=createApp({fetch:fetchMock,logger,rateLimiter});
  const first=await app.request('http://local/api/njkb/DH4786PD',{headers:{'CF-Connecting-IP':'203.0.113.1'}},bindings());
  const secondIp=await app.request('http://local/api/njkb/DH4786PD',{headers:{'CF-Connecting-IP':'203.0.113.2'}},bindings());
  expect(first.status).toBe(200);expect(secondIp.status).toBe(200);
  expect(rateLimiter.check).toHaveBeenCalledWith('cf:203.0.113.1');expect(rateLimiter.check).toHaveBeenCalledWith('cf:203.0.113.2');
 });
 it('returns HTTP 429 without calling BPAD or D1 when the isolate limiter rejects',async()=>{
  const rateLimiter={check:vi.fn(()=>({allowed:false,retryAfterSeconds:7}))};
  const fetchMock=vi.fn(async()=>jsonResponse(bpadPayload));
  const app=createApp({fetch:fetchMock,logger,rateLimiter});
  const response=await app.request('http://local/api/njkb/DH4786PD',{headers:{'CF-Connecting-IP':'203.0.113.10'}},bindings());
  const json=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('7');
  expect(json).toMatchObject({status:'invalid_request',error:{code:'rate_limit_exceeded'}});
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await db.prepare('SELECT count(*) AS n FROM match_audits').first<{n:number}>())?.n).toBe(0);
 });
 it('logs method and sanitized path without NOPOL',async()=>{
  await request(bpadPayload,'http://local/api/njkb/DH4786PD');
  expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({event:'http_request',method:'GET',path:'/api/njkb/:nopol'}));
  expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('DH4786PD');
 });
});

describe('GET /api/njkb/:nopol',()=>{
 it('matches DH1823HJ through MINIBUS category normalization and exact code',async()=>{
  await seedMobilio2019(db);
  const {response,json}=await request(bpadMobilio2019,'http://local/api/njkb/DH1823HJ');
  expect(response.status).toBe(200);
  expect(json).toEqual({status:'matched',nopol:'DH1823HJ',vehicle:{brand:'HONDA',type:'HONDA MOBILIO DD4 1.5 S MT CKD',year:2019},
   njkb:{value:'150000000.00',weight:'1.050000',dpp_pkb:'157500000.00'},
   match:{method:'exact_code_year_and_brand_type',source_code:'103167 40649'},
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',pdf_page:181,source_row:'2587'}});
  expect(JSON.stringify(json)).not.toMatch(/edition_id|reference_id|PRIVATE|tax_year/);
 });

 // Test 1 — Historical exact code (vehicle_year 2024 → Pergub NTT 26/2025)
 it('Test 1 — returns matched for vehicle_year 2024 using Pergub NTT 26/2025',async()=>{
  const {response,json}=await request(bpadPayload,'http://local/api/njkb/DH4786PD');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(json).toEqual({
   status:'matched',nopol:'DH4786PD',
   vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2024},
   njkb:{value:'12500000.00',weight:'1.000000',dpp_pkb:'12500000.00'},
   match:{method:'exact_code_year_and_brand_type',source_code:'701167 08549'},
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',pdf_page:503,source_row:'5310'}
  });
  expect(JSON.stringify(json)).not.toMatch(/PRIVATE|document_sha256|tax_year/);
 });

 // Test 2 — Historical 2025 (boundary year → Pergub NTT 26/2025)
 it('Test 2 — returns matched for vehicle_year 2025 (boundary year) using Pergub NTT 26/2025',async()=>{
  const {response,json}=await request(bpad2025,'http://local/api/njkb/DH2025AA');
  expect(response.status).toBe(200);
  expect(json).toEqual({
   status:'matched',nopol:'DH2025AA',
   vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2025},
   njkb:{value:'12600000.00',weight:'1.000000',dpp_pkb:'12600000.00'},
   match:{method:'exact_code_year_and_brand_type',source_code:'701167 08549'},
   source:{regulation:'Pergub NTT No. 26 Tahun 2025',pdf_page:503,source_row:'5311'}
  });
  expect(JSON.stringify(json)).not.toMatch(/tax_year|Permendagri/);
 });

 // Test 3 — Current 2026 exact code (Permendagri 11/2026)
 it('Test 3 — returns matched for vehicle_year 2026 using Permendagri 11/2026',async()=>{
  const {response,json}=await request(bpad2026,'http://local/api/njkb/dh2026zz');
  expect(response.status).toBe(200);
  expect(json).toEqual({
   status:'matched',nopol:'DH2026ZZ',
   vehicle:{brand:'HONDA',type:'C1M02N42L1 A/T',year:2026},
   njkb:{value:'12900000.00',weight:'1.000000',dpp_pkb:'12900000.00'},
   match:{method:'exact_code_year_and_brand_type',source_code:'701167 67749'},
   source:{regulation:'Permendagri No. 11 Tahun 2026',pdf_page:55,source_row:'311'}
  });
  expect(JSON.stringify(json)).not.toMatch(/PRIVATE|document_sha256|tax_year/);
 });

 // Test 4 — Cross-year protection: 2024 must NOT use Permendagri
 it('Test 4 — vehicle_year 2024 response references Pergub, not Permendagri',async()=>{
  const {response,json}=await request(bpadPayload,'http://local/api/njkb/DH4786PD');
  expect(response.status).toBe(200);
  expect(json.status).toBe('matched');
  const source=json.source as Record<string,unknown>;
  expect(String(source.regulation)).toContain('Pergub');
  expect(String(source.regulation)).not.toContain('Permendagri');
  expect(JSON.stringify(json)).not.toMatch(/12900000/);
 });

 // Test 5 — Cross-year protection: 2026 must NOT use Pergub
 it('Test 5 — vehicle_year 2026 response references Permendagri, not Pergub',async()=>{
  const {response,json}=await request(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(200);
  expect(json.status).toBe('matched');
  const source=json.source as Record<string,unknown>;
  expect(String(source.regulation)).toContain('Permendagri');
  expect(String(source.regulation)).not.toContain('Pergub');
  expect(JSON.stringify(json)).not.toMatch(/12500000|12600000/);
 });

 // Test 6 — No adjacent-year fallback
 it('Test 6 — unknown identity in covered year returns not_found, no adjacent-year value',async()=>{
  const {response,json}=await request({...bpad2026,Merk:'YAMAHA',KD_MERK:'999',Type:'UNKNOWN',KD_TIPE:'UNKNOWN'},
   'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(404);
  expect(json).toEqual({status:'not_found',nopol:'DH2026ZZ',vehicle:{brand:'YAMAHA',type:'UNKNOWN',year:2026}});
  expect(json).not.toHaveProperty('njkb');
 });

 // Test 7 — Different code, same identity: exact_identity used, no alias
 it('Test 7 — different code with matching identity resolves via exact_identity, no alias created',async()=>{
  const {response,json}=await request({...bpad2026,KD_TIPE:'701167 08549'},'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(200);
  expect(json.status).toBe('matched');
  const match=json.match as Record<string,unknown>;
  expect(match.method).toBe('exact_brand_type_year_and_category');
  expect(match.source_code).toBe('701167 67749');
  expect((await db.prepare('SELECT count(*) AS n FROM vehicle_code_mappings').first<{n:number}>())?.n).toBe(0);
 });

 // Test 8 — Unknown vehicle
 it('Test 8 — unknown vehicle in covered year/category returns not_found',async()=>{
  const {response,json}=await request({...bpad2026,Merk:'SUZUKI',KD_MERK:'SZK',Type:'GSX_UNKNOWN',KD_TIPE:'ZZZZ'},
   'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(404);
  expect(json.status).toBe('not_found');
  expect(json).not.toHaveProperty('njkb');
 });

 // Test 9 — Unsupported query parameter (Phase 5 regression)
 it('Test 9 — rejects tax_year because it is not a public lookup parameter',async()=>{
  const {response,json,fetchMock}=await request(bpadPayload,'http://local/api/njkb/DH4786PD?tax_year=2025');
  expect(response.status).toBe(400);
  expect(json).toMatchObject({status:'invalid_request',error:{code:'unsupported_query_parameter'}});
  expect(fetchMock).not.toHaveBeenCalled();
 });

 // Regulatory boundary explicit test
 it('Boundary — vehicle_year 2025 resolves from Pergub; vehicle_year 2026 resolves from Permendagri',async()=>{
  const res2025=await request(bpad2025,'http://local/api/njkb/DH2025AA');
  const res2026=await request(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(res2025.response.status).toBe(200);
  expect(res2026.response.status).toBe(200);
  const src2025=res2025.json.source as Record<string,unknown>;
  const src2026=res2026.json.source as Record<string,unknown>;
  expect(String(src2025.regulation)).toContain('Pergub');
  expect(String(src2026.regulation)).toContain('Permendagri');
 });

 // Phase 5 regressions
 it('returns ambiguous without selecting a candidate',async()=>{
  const data=structuredClone(fixture);
  data.njkb_references=[{...data.njkb_references[4],id:'api-duplicate',source_row:'312'}];
  await importDataset(db,data);
  const {response,json}=await request(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(409);
  expect(json).toMatchObject({status:'ambiguous',nopol:'DH2026ZZ',match:{method:'exact_code_year_and_brand_type'}});
  expect(json).not.toHaveProperty('njkb');
  expect(json).not.toHaveProperty('candidates');
 });
 it('returns conflict without exposing the conflicting reference value',async()=>{
  await db.prepare("UPDATE njkb_references SET brand='YAMAHA',brand_normalized='YAMAHA' WHERE id='fixture-b'").run();
  const {response,json}=await request(bpad2026,'http://local/api/njkb/DH2026ZZ');
  expect(response.status).toBe(409);
  expect(json).toMatchObject({status:'conflict',match:{method:'exact_code_year_and_brand_type',conflicts:['brand']}});
  expect(json).not.toHaveProperty('njkb');
 });
 it('preserves an upstream failure as a structured upstream_error',async()=>{
  const {response,json}=await request({message:'down'},'http://local/api/njkb/DH4786PD',503);
  expect(response.status).toBe(502);
  expect(json).toMatchObject({status:'upstream_error',nopol:'DH4786PD',error:{code:'http_error',message:'Layanan kendaraan BPAD sedang tidak tersedia'}});
  expect((json.error as Record<string,unknown>).request_id).toBe(response.headers.get('x-request-id'));
 });
 it('maps an upstream timeout to HTTP 504',async()=>{
  const fetchMock=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
   init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));
  }));
  const app=createApp({fetch:fetchMock,logger});
  const response=await app.request('http://local/api/njkb/DH4786PD',{},bindings());
  const json=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(504);
  expect(json).toMatchObject({status:'upstream_error',error:{code:'timeout'}});
 });
 it('rejects invalid NOPOL before calling BPAD',async()=>{
  const {response,json,fetchMock}=await request(bpadPayload,'http://local/api/njkb/INVALID');
  expect(response.status).toBe(400);
  expect(json).toMatchObject({status:'invalid_request',error:{code:'invalid_nopol'}});
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it('returns a structured database error without leaking its cause',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(bpad2026));
  const app=createApp({fetch:fetchMock,logger});
  const failingDb={prepare(){throw new Error('sensitive SQL details');}} as unknown as D1Database;
  const response=await app.request('http://local/api/njkb/DH2026ZZ',{},{...bindings(),NJKB_DB:failingDb});
  const json=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(503);
  expect(json).toMatchObject({status:'error',error:{code:'database_error'}});
  expect(JSON.stringify(json)).not.toContain('sensitive SQL details');
 });
 it('returns a structured matching error for an unexpected engine failure',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(bpad2026));
  const brokenRepository={approvedEditions:async()=>{throw new Error('internal matcher detail');}} as unknown as NjkbRepository;
  const app=createApp({fetch:fetchMock,logger,matcherFactory:()=>new NjkbMatchingEngine(brokenRepository)});
  const response=await app.request('http://local/api/njkb/DH2026ZZ',{},bindings());
  const json=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(500);
  expect(json).toMatchObject({status:'error',error:{code:'matching_error'}});
  expect(JSON.stringify(json)).not.toContain('internal matcher detail');
 });
 it('logs request metadata without NOPOL or upstream vehicle fields',async()=>{
  await request(bpad2026,'http://local/api/njkb/DH2026ZZ');
  const logged=JSON.stringify(vi.mocked(logger.info).mock.calls);
  expect(logged).not.toMatch(/DH2026ZZ|PRIVATE|HONDA/);
 });
});
