import {describe,expect,it,vi} from 'vitest';
import {authorize,expandScopes,jwtContractSchema,parseScopeClaim,type AuthPrincipal,type PrivateScope} from '../src/auth/contracts';
import {createApp,type Bindings,type SafeLogger} from '../src/index';
import {normalizeBpadRecord} from '../src/bpad/normalize';
import {parseBpadVehicleRecord} from '../src/bpad/types';
import {privateError,shapeUnifiedVehicleResponse,type UnifiedCompositionInput} from '../src/private-api/contracts';
import privateOpenapi from '../docs/openapi-private.json';
import publicOpenapi from '../docs/openapi.json';
import {knownBpadFields} from '../src/bpad/types';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';

const principal=(scopes:PrivateScope[]):AuthPrincipal=>({subject:'synthetic-service',issuer:'https://issuer.invalid.example',audience:['njkb-private-api'],scopes:new Set(scopes),expiresAt:4_102_444_800,notBefore:null});
const normalized=normalizeBpadRecord(parseBpadVehicleRecord(syntheticFullBpadRecord).raw);
const input:UnifiedCompositionInput={bpad:normalized,njkbStatus:'matched',njkb:{value:'150000000.00',weight:'1.050000',dpp_pkb:'157500000.00'},match:{method:'exact_code_year_and_brand_type',source_code:'103167 40649'},source:{regulation:'Pergub NTT No. 26 Tahun 2025',pdf_page:181,source_row:'2587'}};

describe('private authentication and scope contract foundation',()=>{
 it('defines a strict JWT claim contract without hard-coded production issuer/audience',()=>{
  const claims=jwtContractSchema.parse({sub:'synthetic-service',iss:'https://issuer.invalid.example',aud:['njkb-private-api'],exp:4_102_444_800,scope:['vehicle:read','njkb:read']});
  expect(claims.scope).toEqual(['vehicle:read','njkb:read']);expect([...parseScopeClaim('vehicle:read njkb:read')]).toEqual(['vehicle:read','njkb:read']);
  expect(()=>parseScopeClaim(['vehicle:read','unknown:scope'])).toThrow('Unsupported private API scope');
  expect(jwtContractSchema.parse({...claims,provider_extra:'synthetic'})).toMatchObject({sub:'synthetic-service',provider_extra:'synthetic'});
 });

 it('treats vehicle:full as an explicit bundle of all six granular scopes',()=>{
  expect([...expandScopes(['vehicle:full'])].sort()).toEqual(['bpad:raw','njkb:read','owner:read','registration:read','tax:read','vehicle:read']);
 });

 it('authorizes exact and multiple scopes and reports missing scopes safely',()=>{
  expect(authorize(principal(['vehicle:read','njkb:read']),['vehicle:read']).allowed).toBe(true);
  expect(authorize(principal(['vehicle:read','njkb:read']),['vehicle:read','njkb:read']).allowed).toBe(true);
  expect(authorize(principal(['vehicle:read']),['owner:read'])).toEqual({allowed:false,code:'insufficient_scope',missingScopes:['owner:read']});
 });
});

describe('scope-aware private response contract foundation',()=>{
 it('returns only basic vehicle and BPAD metadata for vehicle:read',()=>{
  const decision=authorize(principal(['vehicle:read']),['vehicle:read']);if(!decision.allowed)throw new Error('unexpected');
  const response=shapeUnifiedVehicleResponse(input,decision.effectiveScopes);
  expect(response).toMatchObject({status:'vehicle_found',vehicle_status:'found',njkb_status:'matched',nopol:'ZZ0001ZZ',vehicle:{category:'MOBIL PENUMPANG',category_raw:'MINIBUS'}});
  expect(response).not.toHaveProperty('owner');expect(response).not.toHaveProperty('registration');expect(response).not.toHaveProperty('tax');expect(response).not.toHaveProperty('njkb');expect(response.bpad).not.toHaveProperty('raw');
  expect(response.vehicle).not.toHaveProperty('chassis_number');expect(response.vehicle).not.toHaveProperty('engine_number');expect(response.vehicle).not.toHaveProperty('plate_color');
 });

 it('adds owner only with owner:read and raw only with bpad:raw',()=>{
  const ownerScopes=expandScopes(['vehicle:read','owner:read']);const ownerResponse=shapeUnifiedVehicleResponse(input,ownerScopes);
  expect(ownerResponse.owner?.name).toBe('TEST OWNER');expect(ownerResponse).not.toHaveProperty('registration');expect(ownerResponse.bpad).not.toHaveProperty('raw');
  const rawResponse=shapeUnifiedVehicleResponse(input,expandScopes(['vehicle:read','bpad:raw']));
  expect(rawResponse.bpad.raw?.FutureBpadFieldExample).toBe('synthetic-value');expect(rawResponse).not.toHaveProperty('owner');
 });

 it('adds registration, tax, NJKB, and sensitive vehicle identifiers only with matching scopes',()=>{
  const response=shapeUnifiedVehicleResponse(input,expandScopes(['vehicle:read','registration:read','tax:read','njkb:read']));
  expect(response.registration?.bpkb_number).toBe('TEST-BPKB-0001');expect(response.tax?.notice_valid_until).toBe('2030-12-31');expect(response.njkb?.value).toBe('150000000.00');
  expect(response.vehicle.chassis_number).toBe('TEST-CHASSIS-0001');expect(response.vehicle.engine_number).toBe('TEST-ENGINE-0001');expect(response).not.toHaveProperty('owner');
 });

 it('vehicle:full exposes the approved bundle without inventing phone',()=>{
  const response=shapeUnifiedVehicleResponse(input,expandScopes(['vehicle:full']));
  expect(response.owner?.name).toBe('TEST OWNER');expect(response.registration).toBeDefined();expect(response.tax).toBeDefined();expect(response.njkb).toBeDefined();expect(response.bpad.raw).toBeDefined();expect(response.owner).not.toHaveProperty('phone');
 });

 it('requires vehicle:read before any vehicle response can be shaped',()=>{
  expect(()=>shapeUnifiedVehicleResponse(input,expandScopes(['owner:read']))).toThrow('vehicle:read');
 });

 it('serializes safe errors without accepting arbitrary raw/PII fields',()=>{
  const error=privateError('unauthorized','Kredensial diperlukan','00000000-0000-4000-8000-000000000000');
  expect(error).toEqual({status:'unauthorized',error:{code:'unauthorized',message:'Kredensial diperlukan',request_id:'00000000-0000-4000-8000-000000000000'}});
  expect(JSON.stringify(error)).not.toMatch(/TEST OWNER|NoKTP|raw|token|stack|SQL/);
 });

 it('publishes a separate machine-readable private contract without activating the public contract',()=>{
  expect(privateOpenapi.openapi).toBe('3.1.0');expect(privateOpenapi['x-lifecycle']).toBe('pre-deployment-security-gate-ready-production-not-active');
  expect(privateOpenapi.paths['/api/v1/vehicle/{nopol}'].get['x-production-active']).toBe(false);
  expect(privateOpenapi.components.securitySchemes.AccessClientId).toMatchObject({type:'apiKey',in:'header',name:'CF-Access-Client-Id'});
  expect(privateOpenapi.components.securitySchemes.AccessClientSecret).toMatchObject({type:'apiKey',in:'header',name:'CF-Access-Client-Secret'});
  expect(Object.keys(privateOpenapi.components.schemas.BPADRaw.properties).sort()).toEqual([...knownBpadFields].sort());
  expect(privateOpenapi.components.schemas.BPADRaw.additionalProperties).toBe(true);
  expect(JSON.stringify(privateOpenapi)).not.toMatch(/ae3097b9|database_id|private_key|bearer-token/);expect(privateOpenapi.components.schemas.Owner.properties).not.toHaveProperty('phone');
  expect(Object.keys(publicOpenapi.paths).sort()).toEqual(['/api/njkb/{nopol}','/health','/ready']);
 });
});

describe('private endpoint activation safety',()=>{
 it('fails closed with HTTP 503 and no BPAD call when auth configuration is absent',async()=>{
  const fetchMock=vi.fn();const logger:SafeLogger={info:vi.fn(),error:vi.fn()};const app=createApp({fetch:fetchMock,logger});
  const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{},{} as Bindings);const body=await response.json() as Record<string,unknown>;
  expect(response.status).toBe(503);expect(body).toMatchObject({status:'error',error:{code:'internal_error'}});expect(fetchMock).not.toHaveBeenCalled();
 });
});
