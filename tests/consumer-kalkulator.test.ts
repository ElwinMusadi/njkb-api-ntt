import {describe,expect,it,vi} from 'vitest';
import {APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,CloudflareAccessServiceAuthenticator,parseAccessServiceConfiguration} from '../src/auth/access';
import {HttpsJwksKeyResolver} from '../src/auth/jwks';
import {createApp,type Bindings,type RequestRateLimiter,type SafeLogger} from '../src/index';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';
import {createTestDatabase,jsonResponse,seedMobilio2019} from './support';

const issuer='https://shy-thunder-ffc9.cloudflareaccess.com';
const audience='927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa';
const nowMs=1_500_000_000_000;

// Production Cloudflare Access identifiers
const canaryCommonName='d6bb9db60e9cd5ee91327eed387cf2fb.access';
const kalkulatorCommonName='258c62aadaa1dad3ca33f871d8439a88.access';

export const dualGrantsJson=JSON.stringify([
 {
  access_common_name:canaryCommonName,
  principal:'njkb-api-canary',
  scopes:['vehicle:read','njkb:read']
 },
 {
  access_common_name:kalkulatorCommonName,
  principal:'kalkulator-pajak-kendaraan',
  scopes:['vehicle:read','registration:read','owner:read','tax:read','njkb:read']
 }
]);

const b64=(value:Uint8Array|string):string=>{
 const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
 let binary='';
 for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
};

const createKeys=async()=>{
 const pair=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,
  ['sign','verify']
 ) as CryptoKeyPair;
 const exported=await crypto.subtle.exportKey('jwk',pair.publicKey);
 return {
  pair,
  jwk:{kty:'RSA',n:exported.n!,e:exported.e!,kid:'synthetic-access-key',alg:'RS256',use:'sig',key_ops:['verify']}
 };
};

const sign=async(privateKey:CryptoKey,commonName:string,overrides:Record<string,unknown>={})=>{
 const header=b64(JSON.stringify({alg:'RS256',kid:'synthetic-access-key',typ:'JWT'}));
 const payload=b64(JSON.stringify({
  type:'app',
  aud:[audience],
  exp:2_000_000_000,
  iat:1_499_999_900,
  nbf:1_499_999_900,
  iss:issuer,
  sub:'',
  common_name:commonName,
  ...overrides
 }));
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(`${header}.${payload}`));
 return `${header}.${payload}.${b64(new Uint8Array(signature))}`;
};

describe('Consumer Onboarding & Remediation: Kalkulator Pajak Kendaraan', ()=>{
 it('parses production dual grants preserving canary and enforcing kalkulator remediated scopes', ()=>{
  const parsed=parseAccessServiceConfiguration({
   issuer,
   audience,
   jwksUrl:`${issuer}/cdn-cgi/access/certs`,
   clockToleranceSeconds:APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,
   grantsJson:dualGrantsJson
  });

  expect(parsed.grants).toHaveLength(2);

  // A. Existing canary still resolves exactly
  const canaryGrant=parsed.grants.find(g=>g.principal==='njkb-api-canary');
  expect(canaryGrant).toBeDefined();
  expect(canaryGrant!.accessCommonName).toBe(canaryCommonName);
  expect([...canaryGrant!.scopes]).toEqual(['vehicle:read','njkb:read']);
  expect(canaryGrant!.scopes.has('registration:read')).toBe(false);
  expect(canaryGrant!.scopes.has('owner:read')).toBe(false);
  expect(canaryGrant!.scopes.has('tax:read')).toBe(false);
  expect(canaryGrant!.scopes.has('bpad:raw')).toBe(false);
  expect(canaryGrant!.scopes.has('vehicle:full')).toBe(false);

  // B. Remediated consumer resolves with actual Client ID and includes tax:read
  const kalkulatorGrant=parsed.grants.find(g=>g.principal==='kalkulator-pajak-kendaraan');
  expect(kalkulatorGrant).toBeDefined();
  expect(kalkulatorGrant!.accessCommonName).toBe('258c62aadaa1dad3ca33f871d8439a88.access');
  expect([...kalkulatorGrant!.scopes].sort()).toEqual(['njkb:read','owner:read','registration:read','tax:read','vehicle:read']);
  expect(kalkulatorGrant!.scopes.has('tax:read')).toBe(true);

  // C. Distinct principals
  expect(kalkulatorGrant!.principal).not.toBe(canaryGrant!.principal);

  // D. Forbidden scopes strictly NOT granted
  expect(kalkulatorGrant!.scopes.has('bpad:raw')).toBe(false);
  expect(kalkulatorGrant!.scopes.has('vehicle:full')).toBe(false);
 });

 it('rejects unknown common_name and enforces unique common_name in parser', ()=>{
  const parsed=parseAccessServiceConfiguration({
   issuer,
   audience,
   jwksUrl:`${issuer}/cdn-cgi/access/certs`,
   clockToleranceSeconds:APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,
   grantsJson:dualGrantsJson
  });

  expect(parsed.grants.find(g=>g.accessCommonName==='unknown.access')).toBeUndefined();

  // Duplicate common name rejected
  const duplicateJson=JSON.stringify([
   {access_common_name:kalkulatorCommonName,principal:'kalkulator-a',scopes:['vehicle:read']},
   {access_common_name:kalkulatorCommonName,principal:'kalkulator-b',scopes:['vehicle:read']}
  ]);
  expect(()=>parseAccessServiceConfiguration({
   issuer,
   audience,
   jwksUrl:`${issuer}/cdn-cgi/access/certs`,
   clockToleranceSeconds:APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,
   grantsJson:duplicateJson
  })).toThrow();
 });

 it('authenticates kalkulator-pajak-kendaraan assertion and shapes response exposing all nine business requirements', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  await seedMobilio2019(db);

  const logger:SafeLogger={info:vi.fn(),error:vi.fn()};
  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>
   String(input)===jwksUrl
    ? new Response(JSON.stringify({keys:[keys.jwk]}))
    : jsonResponse(syntheticFullBpadRecord)
  );

  try {
   const rateLimiter:RequestRateLimiter={check:vi.fn(()=>({allowed:true,retryAfterSeconds:0}))};
   const app=createApp({fetch:fetcher,logger,rateLimiter});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:dualGrantsJson
   };

   const token=await sign(keys.pair.privateKey,kalkulatorCommonName);
   const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':token}
   },env);

   expect(response.status).toBe(200);
   expect(response.headers.get('cache-control')).toBe('no-store');

   const body=await response.json() as Record<string,unknown>;

   // ==========================================
   // VERIFY ALL NINE REQUIRED BUSINESS FIELDS:
   // ==========================================
   // 1. Nopol (root nopol)
   expect(body.nopol).toBe('ZZ0001ZZ');

   // 2. Nama Pemilik (owner:read -> owner.name)
   expect((body.owner as Record<string,unknown>).name).toBe('TEST OWNER');

   // 3. NJKB (njkb:read -> njkb.value)
   expect((body.njkb as Record<string,unknown>).value).toBe('150000000.00');

   // 4. NJUB / Nilai Ubah Bentuk (vehicle:read -> vehicle.body_modification)
   expect((body.vehicle as Record<string,unknown>).body_modification).toBe('[ --- TIDAK ADA PERUBAHAN --- ]');

   // 5. Jenis Kendaraan (vehicle:read -> vehicle.category & vehicle.type)
   expect((body.vehicle as Record<string,unknown>).category).toBe('MOBIL PENUMPANG');
   expect((body.vehicle as Record<string,unknown>).type).toBe('HONDA MOBILIO DD4 1.5 S MT CKD');

   // 6. SD Notice / Jatuh Tempo Pajak (tax:read -> tax.notice_valid_until)
   expect((body.tax as Record<string,unknown>).notice_valid_until).toBe('2030-12-31');

   // 7. SD STNK / Jatuh Tempo STNK (registration:read -> registration.stnk_valid_until)
   expect((body.registration as Record<string,unknown>).stnk_valid_until).toBe('2031-12-31');

   // 8. Warna TNKB (registration:read -> registration.plate_color & vehicle.plate_color)
   expect((body.registration as Record<string,unknown>).plate_color).toBe('PUTIH');
   expect((body.vehicle as Record<string,unknown>).plate_color).toBe('PUTIH');

   // 9. Pengguna Kendaraan / GUNA (registration:read -> registration.usage)
   expect((body.registration as Record<string,unknown>).usage).toBe('PRIBADI');

   // ==========================================
   // INVENTORY OF TAX SCOPE FIELDS:
   // ==========================================
   expect(body.tax).toMatchObject({
    notice_valid_until:'2030-12-31',
    previous_pkb_date:'2029-12-31',
    kohir:'000123'
   });

   // Sensitive registration identifiers allowed by registration:read contract
   expect((body.vehicle as Record<string,unknown>).chassis_number).toBe('TEST-CHASSIS-0001');
   expect((body.vehicle as Record<string,unknown>).engine_number).toBe('TEST-ENGINE-0001');
   expect((body.registration as Record<string,unknown>).bpkb_number).toBe('TEST-BPKB-0001');

   // Forbidden scopes strictly omitted
   expect((body.bpad as object)).not.toHaveProperty('raw');
   expect(JSON.stringify(body)).not.toMatch(/KD_LOKASI_ASAL/);

   // Rate limiter tagged with exact consumer principal
   expect(rateLimiter.check).toHaveBeenCalledWith('principal:kalkulator-pajak-kendaraan');
  } finally {
   await mf.dispose();
  }
 });

 it('enforces scope isolation between canary and kalkulator consumers simultaneously', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  await seedMobilio2019(db);

  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>
   String(input)===jwksUrl
    ? new Response(JSON.stringify({keys:[keys.jwk]}))
    : jsonResponse(syntheticFullBpadRecord)
  );

  try {
   const rateLimiter:RequestRateLimiter={check:vi.fn(()=>({allowed:true,retryAfterSeconds:0}))};
   const app=createApp({fetch:fetcher,logger:{info:vi.fn(),error:vi.fn()},rateLimiter});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:dualGrantsJson
   };

   // 1. Canary call: vehicle:read, njkb:read only (NO tax:read)
   const canaryToken=await sign(keys.pair.privateKey,canaryCommonName);
   const canaryResp=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':canaryToken}
   },env);
   expect(canaryResp.status).toBe(200);
   const canaryBody=await canaryResp.json() as Record<string,unknown>;
   expect(canaryBody).toHaveProperty('vehicle');
   expect(canaryBody).toHaveProperty('njkb');
   expect(canaryBody).not.toHaveProperty('tax'); // tax:read NOT granted to canary
   expect(canaryBody).not.toHaveProperty('owner');
   expect(canaryBody).not.toHaveProperty('registration');
   expect((canaryBody.bpad as object)).not.toHaveProperty('raw');
   expect(rateLimiter.check).toHaveBeenCalledWith('principal:njkb-api-canary');

   // 2. Kalkulator call: vehicle:read, registration:read, owner:read, tax:read, njkb:read
   const kalkulatorToken=await sign(keys.pair.privateKey,kalkulatorCommonName);
   const kalkulatorResp=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':kalkulatorToken}
   },env);
   expect(kalkulatorResp.status).toBe(200);
   const kalkulatorBody=await kalkulatorResp.json() as Record<string,unknown>;
   expect(kalkulatorBody).toHaveProperty('vehicle');
   expect(kalkulatorBody).toHaveProperty('registration');
   expect(kalkulatorBody).toHaveProperty('owner');
   expect(kalkulatorBody).toHaveProperty('tax'); // tax:read GRANTED to kalkulator
   expect(kalkulatorBody).toHaveProperty('njkb');
   expect((kalkulatorBody.tax as Record<string,unknown>).notice_valid_until).toBe('2030-12-31');
   expect((kalkulatorBody.bpad as object)).not.toHaveProperty('raw'); // bpad:raw still NOT granted
   expect(rateLimiter.check).toHaveBeenCalledWith('principal:kalkulator-pajak-kendaraan');
  } finally {
   await mf.dispose();
  }
 });

 it('keeps tax section completely protected when tax:read is omitted from grant', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  await seedMobilio2019(db);

  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>
   String(input)===jwksUrl
    ? new Response(JSON.stringify({keys:[keys.jwk]}))
    : jsonResponse(syntheticFullBpadRecord)
  );

  try {
   const unprivilegedJson=JSON.stringify([
    {
     access_common_name:kalkulatorCommonName,
     principal:'kalkulator-no-tax',
     scopes:['vehicle:read','registration:read','owner:read','njkb:read']
    }
   ]);
   const app=createApp({fetch:fetcher,logger:{info:vi.fn(),error:vi.fn()},rateLimiter:{check:()=>({allowed:true,retryAfterSeconds:0})}});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:unprivilegedJson
   };

   const token=await sign(keys.pair.privateKey,kalkulatorCommonName);
   const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':token}
   },env);

   expect(response.status).toBe(200);
   const body=await response.json() as Record<string,unknown>;
   expect(body).not.toHaveProperty('tax');
   expect(JSON.stringify(body)).not.toMatch(/notice_valid_until/);
  } finally {
   await mf.dispose();
  }
 });

 it('returns 401 on missing or invalid assertion', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn();

  try {
   const app=createApp({fetch:fetcher,logger:{info:vi.fn(),error:vi.fn()}});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:dualGrantsJson
   };

   // Missing assertion
   const missingResp=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{},env);
   expect(missingResp.status).toBe(401);

   // Invalid assertion token
   const invalidResp=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':'invalid.token.payload'}
   },env);
   expect(invalidResp.status).toBe(401);

   // Upstream BPAD not called
   expect(fetcher).not.toHaveBeenCalled();
  } finally {
   await mf.dispose();
  }
 });

 it('returns 400 on invalid NOPOL or query parameters without calling BPAD', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>
   String(input)===jwksUrl
    ? new Response(JSON.stringify({keys:[keys.jwk]}))
    : jsonResponse(syntheticFullBpadRecord)
  );

  try {
   const app=createApp({fetch:fetcher,logger:{info:vi.fn(),error:vi.fn()}});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:dualGrantsJson
   };

   const token=await sign(keys.pair.privateKey,kalkulatorCommonName);

   // Invalid NOPOL
   const invalidNopol=await app.request('http://local/api/v1/vehicle/INVALID',{
    headers:{'Cf-Access-Jwt-Assertion':token}
   },env);
   expect(invalidNopol.status).toBe(400);

   // Query param unsupported
   const queryParam=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ?extra=val',{
    headers:{'Cf-Access-Jwt-Assertion':token}
   },env);
   expect(queryParam.status).toBe(400);

   // Only JWKS fetched, BPAD never fetched
   expect(fetcher.mock.calls.filter(([input])=>String(input)!==jwksUrl)).toHaveLength(0);
  } finally {
   await mf.dispose();
  }
 });

 it('does not leak token, assertion, NOPOL, or owner PII in audit logger', async()=>{
  const keys=await createKeys();
  const {mf,db}=await createTestDatabase();
  await seedMobilio2019(db);

  const logger:SafeLogger={info:vi.fn(),error:vi.fn()};
  const jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>
   String(input)===jwksUrl
    ? new Response(JSON.stringify({keys:[keys.jwk]}))
    : jsonResponse(syntheticFullBpadRecord)
  );

  try {
   const app=createApp({fetch:fetcher,logger,rateLimiter:{check:()=>({allowed:true,retryAfterSeconds:0})}});
   const env:Bindings={
    NJKB_DB:db,
    BPAD_TIMEOUT_MS:'100',
    NJKB_RESOLUTION_AS_OF:'2026-09-20',
    AUTH_ISSUER:issuer,
    AUTH_AUDIENCE:audience,
    AUTH_JWKS_URL:jwksUrl,
    AUTH_CLOCK_TOLERANCE_SECONDS:'30',
    AUTH_ACCESS_GRANTS_JSON:dualGrantsJson
   };

   const token=await sign(keys.pair.privateKey,kalkulatorCommonName);
   await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{
    headers:{'Cf-Access-Jwt-Assertion':token}
   },env);

   const loggedOutput=JSON.stringify([
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.error).mock.calls
   ]);

   expect(loggedOutput).not.toMatch(/258c62aadaa1dad3ca33f871d8439a88/);
   expect(loggedOutput).not.toMatch(/ZZ0001ZZ/);
   expect(loggedOutput).not.toMatch(/TEST OWNER/);
   expect(loggedOutput).not.toMatch(/TEST ADDRESS/);
   expect(loggedOutput).not.toMatch(/9999999999999999/);
   expect(loggedOutput).not.toMatch(/TEST-BPKB/);
   expect(loggedOutput).not.toMatch(/TEST-CHASSIS/);
   expect(loggedOutput).not.toMatch(/TEST-ENGINE/);
   expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
    path:'/api/v1/vehicle/:nopol',
    method:'GET',
    result:'matched'
   }));
  } finally {
   await mf.dispose();
  }
 });
});
