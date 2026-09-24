import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Miniflare} from 'miniflare';
import type {AuthPrincipal,PrivateScope} from '../src/auth/contracts';
import {AuthenticationError,type JwtVerifier} from '../src/auth/jwt';
import {BearerJwtRequestAuthenticator,type RequestAuthenticator} from '../src/auth/request';
import fixture from '../fixtures/verified.json';
import {importDataset} from '../src/db/import';
import {DatabaseError,MatchingError} from '../src/errors';
import {createApp,type Bindings,type RequestRateLimiter,type SafeLogger} from '../src/index';
import {NjkbMatchingEngine} from '../src/matching/engine';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';
import {createTestDatabase,jsonResponse,seedMobilio2019} from './support';

let mf:Miniflare,db:D1Database;
const logger:SafeLogger={info:vi.fn(),error:vi.fn()};
const bindings=():Bindings=>({NJKB_DB:db,BPAD_TIMEOUT_MS:'100',NJKB_RESOLUTION_AS_OF:'2026-09-20'});
const principal=(scopes:PrivateScope[]):AuthPrincipal=>({subject:'synthetic-service',issuer:'https://issuer.invalid.example',audience:['njkb-private-api'],scopes:new Set(scopes),expiresAt:4_102_444_800,notBefore:null});
const authenticator=(scopes:PrivateScope[]):RequestAuthenticator=>new BearerJwtRequestAuthenticator({verify:vi.fn(async()=>principal(scopes))});
const allowLimiter:RequestRateLimiter={check:vi.fn(()=>({allowed:true,retryAfterSeconds:0}))};
const call=async(options:{payload?:unknown;scopes?:PrivateScope[];authorization?:string|null;authenticator?:RequestAuthenticator;rateLimiter?:RequestRateLimiter;url?:string;upstreamStatus?:number}={})=>{
 const fetchMock=vi.fn(async()=>jsonResponse(options.payload??syntheticFullBpadRecord,options.upstreamStatus??200));
  const auth=options.authenticator??authenticator(options.scopes??['vehicle:read']);
  const app=createApp({fetch:fetchMock,logger,privateAuthenticator:auth,rateLimiter:options.rateLimiter??allowLimiter});
 const headers:Record<string,string>={};if(options.authorization!==null)headers.authorization=options.authorization??'Bearer synthetic.jwt.token';
 const response=await app.request(options.url??'http://local/api/v1/vehicle/ZZ0001ZZ',{headers},bindings());
  return {response,body:await response.json() as Record<string,unknown>,fetchMock,authenticator:auth};
};

beforeEach(async()=>{({mf,db}=await createTestDatabase());await seedMobilio2019(db);vi.clearAllMocks();});
afterEach(async()=>{await mf.dispose();});

describe('private route authentication and upstream ordering',()=>{
 it('returns 401 for missing authorization before verifier, BPAD, or D1 matching',async()=>{
  const result=await call({authorization:null});expect(result.response.status).toBe(401);expect(result.body).toMatchObject({status:'unauthorized',error:{code:'unauthorized'}});
  expect(result.fetchMock).not.toHaveBeenCalled();expect((await db.prepare('SELECT count(*) n FROM match_audits').first<{n:number}>())?.n).toBe(0);
 });

 it('returns 401 for invalid JWT before BPAD or D1 matching',async()=>{
  const invalid:RequestAuthenticator={authenticate:vi.fn(async()=>{throw new AuthenticationError('unauthorized');})};const result=await call({authenticator:invalid});
  expect(result.response.status).toBe(401);expect(result.body).toMatchObject({status:'unauthorized',error:{code:'unauthorized'}});expect(result.fetchMock).not.toHaveBeenCalled();expect((await db.prepare('SELECT count(*) n FROM match_audits').first<{n:number}>())?.n).toBe(0);
 });

 it('returns 503 for provider/JWKS failure without protected calls or internals',async()=>{
  const unavailable:RequestAuthenticator={authenticate:vi.fn(async()=>{throw new AuthenticationError('auth_unavailable');})};const result=await call({authenticator:unavailable});
  expect(result.response.status).toBe(503);expect(result.body).toMatchObject({status:'error',error:{code:'internal_error'}});expect(result.fetchMock).not.toHaveBeenCalled();expect(JSON.stringify(result.body)).not.toMatch(/JWKS|signature|key|token/);
 });

 it('returns 403 for authenticated principal without vehicle:read before BPAD or D1',async()=>{
  const result=await call({scopes:['owner:read']});expect(result.response.status).toBe(403);expect(result.body).toMatchObject({status:'forbidden',error:{code:'forbidden'}});expect(result.fetchMock).not.toHaveBeenCalled();expect((await db.prepare('SELECT count(*) n FROM match_audits').first<{n:number}>())?.n).toBe(0);
 });

 it('authenticates, authorizes, rate-limits by principal, then calls BPAD exactly once',async()=>{
  const events:string[]=[];const auth:RequestAuthenticator={authenticate:vi.fn(async()=>{events.push('authenticate');return principal(['vehicle:read']);})};const rateLimiter:RequestRateLimiter={check:vi.fn(key=>{events.push(`limit:${key}`);return {allowed:true,retryAfterSeconds:0};})};
  const fetchMock=vi.fn(async()=>{events.push('bpad');return jsonResponse(syntheticFullBpadRecord);});const app=createApp({fetch:fetchMock,logger,privateAuthenticator:auth,rateLimiter});const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers:{authorization:'Bearer synthetic.jwt.token'}},bindings());
  expect(response.status).toBe(200);expect(events).toEqual(['authenticate','limit:principal:synthetic-service','bpad']);expect(fetchMock).toHaveBeenCalledOnce();
 });

 it('returns 429 after authentication/authorization but before BPAD when principal limit rejects',async()=>{
  const rateLimiter:RequestRateLimiter={check:vi.fn(()=>({allowed:false,retryAfterSeconds:11}))};const result=await call({rateLimiter});
  expect(result.response.status).toBe(429);expect(result.response.headers.get('retry-after')).toBe('11');expect(result.body).toMatchObject({status:'rate_limit_exceeded',error:{code:'rate_limit_exceeded'}});expect(result.fetchMock).not.toHaveBeenCalled();
 });

 it('returns 400 invalid NOPOL after authorization without calling BPAD',async()=>{
  const result=await call({url:'http://local/api/v1/vehicle/INVALID'});expect(result.response.status).toBe(400);expect(result.body).toMatchObject({status:'invalid_request',error:{code:'invalid_nopol'}});expect(result.fetchMock).not.toHaveBeenCalled();
 });

 it('rejects query parameters after authorization without calling BPAD',async()=>{
  const result=await call({url:'http://local/api/v1/vehicle/ZZ0001ZZ?tax_year=2025'});expect(result.response.status).toBe(400);expect(result.body).toMatchObject({status:'invalid_request',error:{code:'unsupported_query_parameter'}});expect(result.fetchMock).not.toHaveBeenCalled();
 });
});

describe('private route scope-aware response integration',()=>{
 it('vehicle:read returns basic vehicle only and hides every protected section/identifier',async()=>{
  const result=await call({scopes:['vehicle:read']});expect(result.response.status).toBe(200);expect(result.response.headers.get('cache-control')).toBe('no-store');
  expect(result.body).toMatchObject({status:'vehicle_found',vehicle_status:'found',njkb_status:'matched',vehicle:{brand:'HONDA',category:'MOBIL PENUMPANG'}});
  expect(result.body).not.toHaveProperty('registration');expect(result.body).not.toHaveProperty('administrative');expect(result.body).not.toHaveProperty('owner');expect(result.body).not.toHaveProperty('tax');expect(result.body).not.toHaveProperty('njkb');expect((result.body.bpad as object)).not.toHaveProperty('raw');
  expect(result.body.vehicle).not.toHaveProperty('chassis_number');expect(result.body.vehicle).not.toHaveProperty('engine_number');expect(JSON.stringify(result.body)).not.toMatch(/TEST OWNER|TEST ADDRESS|9999999999999999|TEST-BPKB|TEST-CHASSIS|TEST-ENGINE/);
 });

 it('registration:read exposes registration, administration, NoBPKB, NoRangka, and NoMesin but not owner/raw',async()=>{
  const result=await call({scopes:['vehicle:read','registration:read']});expect(result.response.status).toBe(200);
  expect(result.body).toMatchObject({vehicle:{chassis_number:'TEST-CHASSIS-0001',engine_number:'TEST-ENGINE-0001'},registration:{bpkb_number:'TEST-BPKB-0001'},administrative:{dealer_code:'016'}});
  expect(result.body).not.toHaveProperty('owner');expect(result.body).not.toHaveProperty('tax');expect((result.body.bpad as object)).not.toHaveProperty('raw');
 });

 it('owner:read exposes owner only, tax:read exposes tax only, and njkb:read exposes NJKB only',async()=>{
  const owner=await call({scopes:['vehicle:read','owner:read']});expect(owner.body).toMatchObject({owner:{name:'TEST OWNER',identity_number:'9999999999999999',address:'TEST ADDRESS 123'}});expect(owner.body).not.toHaveProperty('registration');
  const tax=await call({scopes:['vehicle:read','tax:read']});expect(tax.body).toMatchObject({tax:{notice_valid_until:'2030-12-31'}});expect(tax.body).not.toHaveProperty('owner');
  const njkb=await call({scopes:['vehicle:read','njkb:read']});expect(njkb.body).toMatchObject({njkb:{value:'150000000.00'},match:{method:'exact_code_year_and_brand_type'},source:{regulation:'Pergub NTT No. 26 Tahun 2025'}});expect(njkb.body).not.toHaveProperty('owner');
 });

 it('bpad:raw exposes exact known, empty, leading-zero, and future nested fields independently',async()=>{
  const payload={...syntheticFullBpadRecord,FutureBpadFieldExample:{nested:['synthetic',1]}};const result=await call({payload,scopes:['vehicle:read','bpad:raw']});expect(result.response.status).toBe(200);
  const raw=(result.body.bpad as {raw:Record<string,unknown>}).raw;expect(raw).toMatchObject({NOPOL:'ZZ0001ZZ',KD_LOKASI_ASAL:'010',KD_POS:'',TahunPembuatan:'2019',FutureBpadFieldExample:{nested:['synthetic',1]}});expect(result.body).not.toHaveProperty('registration');expect(result.body).not.toHaveProperty('owner');
 });

 it('vehicle:full exposes exactly the established six-scope bundle',async()=>{
  const result=await call({scopes:['vehicle:full']});expect(result.response.status).toBe(200);
  for(const section of ['vehicle','registration','administrative','owner','tax','njkb','match','source','bpad'])expect(result.body).toHaveProperty(section);
  expect((result.body.bpad as object)).toHaveProperty('raw');
 });
});

describe('private route independent NJKB status matrix and safe failures',()=>{
 const payload=(overrides:Record<string,unknown>)=>({...syntheticFullBpadRecord,...overrides});
 it('returns 200 vehicle_found + not_found',async()=>{
  const result=await call({payload:payload({NOPOL:'DH2026ZZ',JenisKendaraan:'SEPEDA MOTOR',Merk:'SUZUKI',KD_MERK:'SZK',Type:'UNKNOWN',KD_TIPE:'ZZZZ',TahunPembuatan:'2026'}),scopes:['vehicle:read','njkb:read']});
  expect(result.response.status).toBe(200);expect(result.body).toMatchObject({status:'vehicle_found',vehicle_status:'found',njkb_status:'not_found',njkb:null,match:null,source:null});
 });

 it('returns 200 vehicle_found + reference_unavailable',async()=>{
  const result=await call({payload:payload({NOPOL:'DH2027ZZ',TahunPembuatan:'2027'}),scopes:['vehicle:read','njkb:read']});expect(result.response.status).toBe(200);expect(result.body).toMatchObject({njkb_status:'reference_unavailable',njkb:null});
 });

 it('returns 200 vehicle_found + conflict',async()=>{
  const result=await call({payload:payload({NOPOL:'DH2026ZZ',JenisKendaraan:'SEPEDA MOTOR',Merk:'HONDA',KD_MERK:'167',Type:'WRONG TYPE',KD_TIPE:'701167 67749',TahunPembuatan:'2026'}),scopes:['vehicle:read','njkb:read']});expect(result.response.status).toBe(200);expect(result.body).toMatchObject({njkb_status:'conflict',match:{method:'exact_code_year_and_brand_type',conflicts:['type']},njkb:null});
 });

 it('returns 200 vehicle_found + ambiguous without candidate leakage',async()=>{
  const data=structuredClone(fixture);data.njkb_references=[{...data.njkb_references[4],id:'private-duplicate',source_row:'312'}];await importDataset(db,data);
  const result=await call({payload:payload({NOPOL:'DH2026ZZ',JenisKendaraan:'SEPEDA MOTOR',Merk:'HONDA',KD_MERK:'167',Type:'C1M02N42L1 A/T',KD_TIPE:'701167 67749',TahunPembuatan:'2026'}),scopes:['vehicle:read','njkb:read']});expect(result.response.status).toBe(200);expect(result.body).toMatchObject({njkb_status:'ambiguous',match:{method:'exact_code_year_and_brand_type'},njkb:null});expect(JSON.stringify(result.body)).not.toMatch(/private-duplicate|candidates/);
 });

 it('maps BPAD HTTP failure to safe 502 without raw body or PII',async()=>{
  const result=await call({payload:{secret:'TEST OWNER TEST ADDRESS'},upstreamStatus:503});expect(result.response.status).toBe(502);expect(result.body).toMatchObject({status:'upstream_error',error:{code:'upstream_error'}});expect(JSON.stringify(result.body)).not.toMatch(/TEST OWNER|TEST ADDRESS|secret|503/);
 });

 it('maps database and matching failures to safe private errors',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(syntheticFullBpadRecord));const auth=authenticator(['vehicle:read']);
  const database={match:vi.fn(async()=>{throw new DatabaseError();})} as unknown as NjkbMatchingEngine;const dbApp=createApp({fetch:fetchMock,logger,privateAuthenticator:auth,rateLimiter:allowLimiter,matcherFactory:()=>database});
  const dbResponse=await dbApp.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers:{authorization:'Bearer token'}},bindings());expect(dbResponse.status).toBe(503);expect(await dbResponse.json()).toMatchObject({status:'error',error:{code:'database_error'}});
  const matching={match:vi.fn(async()=>{throw new MatchingError();})} as unknown as NjkbMatchingEngine;const matchApp=createApp({fetch:fetchMock,logger,privateAuthenticator:auth,rateLimiter:allowLimiter,matcherFactory:()=>matching});
  const matchResponse=await matchApp.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers:{authorization:'Bearer token'}},bindings());expect(matchResponse.status).toBe(500);expect(await matchResponse.json()).toMatchObject({status:'error',error:{code:'internal_error'}});
 });
});

describe('private route logging, headers, and public regression',()=>{
 it('never logs JWT, Authorization, NOPOL, owner PII, or raw BPAD',async()=>{
  await call({scopes:['vehicle:full'],authorization:'Bearer SUPER-SECRET-JWT'});const logs=JSON.stringify([...vi.mocked(logger.info).mock.calls,...vi.mocked(logger.error).mock.calls]);
  expect(logs).not.toMatch(/SUPER-SECRET-JWT|Authorization|ZZ0001ZZ|TEST OWNER|TEST ADDRESS|9999999999999999|TEST-BPKB|TEST-CHASSIS|TEST-ENGINE|FutureBpadFieldExample/);
  expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({path:'/api/v1/vehicle/:nopol',method:'GET',result:'matched'}));
 });

 it('keeps security headers, no-store, request ID, and CORS disabled',async()=>{
  const result=await call();expect(result.response.headers.get('cache-control')).toBe('no-store');expect(result.response.headers.get('x-request-id')).toBeTruthy();expect(result.response.headers.get('x-content-type-options')).toBe('nosniff');expect(result.response.headers.get('x-frame-options')).toBe('DENY');expect(result.response.headers.get('referrer-policy')).toBe('no-referrer');expect(result.response.headers.get('strict-transport-security')).toContain('max-age=31536000');expect(result.response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(result.response.headers.get('access-control-allow-origin')).toBeNull();
 });

 it('does not change the existing public endpoint or expose full BPAD fields',async()=>{
  const fetchMock=vi.fn(async()=>jsonResponse(syntheticFullBpadRecord));const app=createApp({fetch:fetchMock,logger,privateAuthenticator:authenticator(['vehicle:full']),rateLimiter:allowLimiter});const response=await app.request('http://local/api/njkb/ZZ0001ZZ',{},bindings());const body=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(200);expect(Object.keys(body).sort()).toEqual(['match','njkb','nopol','source','status','vehicle']);expect(JSON.stringify(body)).not.toMatch(/owner|registration|raw|NamaPemilik|NoKTP|NoBPKB|NoRangka|NoMesin|TEST OWNER/);
 });
});
