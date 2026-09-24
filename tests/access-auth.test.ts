import {describe,expect,it,vi} from 'vitest';
import {APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,CloudflareAccessServiceAuthenticator,parseAccessServiceConfiguration} from '../src/auth/access';
import {AuthenticationError} from '../src/auth/jwt';
import {HttpsJwksKeyResolver} from '../src/auth/jwks';
import {createApp,type Bindings,type SafeLogger} from '../src/index';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';
import {createTestDatabase,jsonResponse,seedMobilio2019} from './support';

const issuer='https://team.synthetic.cloudflareaccess.com',audience='synthetic-access-app-aud',nowMs=1_500_000_000_000;
const b64=(value:Uint8Array|string):string=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');};
const createKeys=async()=>{const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair;const exported=await crypto.subtle.exportKey('jwk',pair.publicKey);return {pair,jwk:{kty:'RSA',n:exported.n!,e:exported.e!,kid:'synthetic-access-key',alg:'RS256',use:'sig',key_ops:['verify']}};};
const sign=async(privateKey:CryptoKey,overrides:Record<string,unknown>={})=>{const header=b64(JSON.stringify({alg:'RS256',kid:'synthetic-access-key',typ:'JWT'})),payload=b64(JSON.stringify({type:'app',aud:[audience],exp:2_000_000_000,iat:1_499_999_900,nbf:1_499_999_900,iss:issuer,sub:'',common_name:'test-service-a.access',...overrides}));const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(`${header}.${payload}`));return `${header}.${payload}.${b64(new Uint8Array(signature))}`;};
const grantsJson=JSON.stringify([{access_common_name:'test-service-a.access',principal:'test-service-a',scopes:['vehicle:read','njkb:read']},{access_common_name:'test-service-b.access',principal:'test-service-b',scopes:['vehicle:read','registration:read','tax:read','njkb:read']}]);
const config=()=>parseAccessServiceConfiguration({issuer,audience,jwksUrl:`${issuer}/cdn-cgi/access/certs`,clockToleranceSeconds:'30',grantsJson});
const authenticator=async()=>{const keys=await createKeys(),fetcher=vi.fn(async()=>new Response(JSON.stringify({keys:[keys.jwk]})));const resolver=new HttpsJwksKeyResolver({jwksUrl:`${issuer}/cdn-cgi/access/certs`,fetch:fetcher,minRefreshIntervalMs:1_000,now:()=>nowMs});return {keys,fetcher,auth:new CloudflareAccessServiceAuthenticator({...config(),keys:resolver,now:()=>nowMs})};};

describe('Cloudflare Access service configuration contract',()=>{
 it('accepts the exact approved canary grant and 30-second clock policy',()=>{
  const grants=JSON.stringify([{access_common_name:'d6bb9db60e9cd5ee91327eed387cf2fb.access',principal:'njkb-api-canary',scopes:['vehicle:read','njkb:read']}]);
  const parsed=parseAccessServiceConfiguration({issuer:'https://shy-thunder-ffc9.cloudflareaccess.com',audience:'927c4e26c78226a08ecf0a50ed91e74f88587dac5f87ac3a91d1e24eb337e4fa',jwksUrl:'https://shy-thunder-ffc9.cloudflareaccess.com/cdn-cgi/access/certs',clockToleranceSeconds:APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS,grantsJson:grants});
  expect(parsed.clockToleranceSeconds).toBe(30);expect(parsed.grants[0].principal).toBe('njkb-api-canary');expect([...parsed.grants[0].scopes]).toEqual(['vehicle:read','njkb:read']);
  for(const forbidden of ['registration:read','tax:read','owner:read','bpad:raw','vehicle:full'] as const)expect(parsed.grants[0].scopes.has(forbidden)).toBe(false);
 });

 it('parses one trusted grant source and preserves least privilege',()=>{
  const parsed=config();expect(parsed).toMatchObject({issuer,audience,jwksUrl:`${issuer}/cdn-cgi/access/certs`,clockToleranceSeconds:30});
  expect(parsed.grants[0].principal).toBe('test-service-a');expect([...parsed.grants[0].scopes]).toEqual(['vehicle:read','njkb:read']);expect(parsed.grants[0].scopes.has('owner:read')).toBe(false);expect(parsed.grants[0].scopes.has('bpad:raw')).toBe(false);
  expect([...parsed.grants[1].scopes]).toEqual(['vehicle:read','registration:read','tax:read','njkb:read']);
 });

 it.each([
  ['empty issuer',{issuer:''}],['non-HTTPS issuer',{issuer:'http://team.invalid'}],['empty audience',{audience:''}],['non-HTTPS JWKS',{jwksUrl:'http://team.invalid/keys'}],['invalid clock tolerance',{clockToleranceSeconds:'61'}],['invalid grants JSON',{grantsJson:'{broken'}],['unknown scope',{grantsJson:JSON.stringify([{access_common_name:'x',principal:'x',scopes:['vehicle:read','root:all']}])}],['missing base vehicle scope',{grantsJson:JSON.stringify([{access_common_name:'x',principal:'x',scopes:['owner:read']}])}],['duplicate common name',{grantsJson:JSON.stringify([{access_common_name:'x',principal:'a',scopes:['vehicle:read']},{access_common_name:'x',principal:'b',scopes:['vehicle:read']}])}],['duplicate principal',{grantsJson:JSON.stringify([{access_common_name:'a',principal:'x',scopes:['vehicle:read']},{access_common_name:'b',principal:'x',scopes:['vehicle:read']}])}]
 ])('fails closed for %s configuration',(_label,override)=>expect(()=>parseAccessServiceConfiguration({...config(),grantsJson,...override})).toThrow());
});

describe('Cloudflare Access service assertion authentication',()=>{
 it('maps cryptographically verified common_name to stable configured service principal and scopes',async()=>{
  const {keys,auth}=await authenticator(),token=await sign(keys.pair.privateKey);const principal=await auth.authenticate(new Request('https://api.synthetic.invalid/private',{headers:{'Cf-Access-Jwt-Assertion':token}}));
  expect(principal).toMatchObject({subject:'test-service-a',issuer,audience:[audience],expiresAt:2_000_000_000,notBefore:1_499_999_900});expect([...principal.scopes]).toEqual(['vehicle:read','njkb:read']);
 });

 it('ignores Authorization and requires a valid Access-specific assertion header',async()=>{
  const {auth}=await authenticator();await expect(auth.authenticate(new Request('https://api.synthetic.invalid/',{headers:{authorization:'Bearer attacker-token'}}))).rejects.toMatchObject({code:'unauthorized'});
  await expect(auth.authenticate(new Request('https://api.synthetic.invalid/',{headers:{authorization:'Bearer attacker-token','Cf-Access-Jwt-Assertion':'invalid.jwt.value'}}))).rejects.toMatchObject({code:'unauthorized'});
 });

 it.each([
  ['wrong issuer',{iss:'https://other.synthetic.cloudflareaccess.com'}],['wrong audience',{aud:['other-aud']}],['expired',{exp:1_499_999_900}],['future nbf',{nbf:1_500_000_100}],['wrong type',{type:'org'}],['missing common_name',{common_name:null}],['unknown service principal',{common_name:'unknown-service.access'}]
 ])('rejects %s assertion',async(_label,overrides)=>{
  const {keys,auth}=await authenticator();
  await expect(auth.authenticate(new Request('https://api.synthetic.invalid/',{headers:{'Cf-Access-Jwt-Assertion':await sign(keys.pair.privateKey,overrides)}}))).rejects.toMatchObject({code:'unauthorized'});
 });

 it('rejects a forged Access assertion and provider/JWKS failure safely',async()=>{
  const trusted=await authenticator(),forged=await createKeys();await expect(trusted.auth.authenticate(new Request('https://api.synthetic.invalid/',{headers:{'Cf-Access-Jwt-Assertion':await sign(forged.pair.privateKey)}}))).rejects.toMatchObject({code:'unauthorized'});
  const unavailable=new CloudflareAccessServiceAuthenticator({...config(),keys:{resolve:vi.fn(async()=>{throw new AuthenticationError('auth_unavailable');})},now:()=>nowMs});
  await expect(unavailable.authenticate(new Request('https://api.synthetic.invalid/',{headers:{'Cf-Access-Jwt-Assertion':await sign(trusted.keys.pair.privateKey)}}))).rejects.toMatchObject({code:'auth_unavailable'});
 });

 it('uses the stable configured principal as the rate-limit and audit identity without token/client secret data',async()=>{
  const {keys,auth}=await authenticator(),principal=await auth.authenticate(new Request('https://api.synthetic.invalid/',{headers:{'Cf-Access-Jwt-Assertion':await sign(keys.pair.privateKey)}}));
  expect(`principal:${principal.subject}`).toBe('principal:test-service-a');expect(JSON.stringify(principal)).not.toMatch(/client_secret|JWT|token|CF-Access/);
 });

 it('builds and caches the Access authenticator from complete runtime bindings',async()=>{
  const keys=await createKeys(),{mf,db}=await createTestDatabase();await seedMobilio2019(db);const logger:SafeLogger={info:vi.fn(),error:vi.fn()},jwksUrl=`${issuer}/cdn-cgi/access/certs`;
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input)===jwksUrl?new Response(JSON.stringify({keys:[keys.jwk],public_cert:{kid:keys.jwk.kid,cert:'SYNTHETIC'},public_certs:[{kid:keys.jwk.kid,cert:'SYNTHETIC'}]})):jsonResponse(syntheticFullBpadRecord));
  try {
   const app=createApp({fetch:fetcher,logger,rateLimiter:{check:()=>({allowed:true,retryAfterSeconds:0})}});const env:Bindings={NJKB_DB:db,BPAD_TIMEOUT_MS:'100',NJKB_RESOLUTION_AS_OF:'2026-09-20',AUTH_ISSUER:issuer,AUTH_AUDIENCE:audience,AUTH_JWKS_URL:jwksUrl,AUTH_CLOCK_TOLERANCE_SECONDS:'30',AUTH_ACCESS_GRANTS_JSON:grantsJson};const headers={'Cf-Access-Jwt-Assertion':await sign(keys.pair.privateKey)};
   expect((await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers},env)).status).toBe(200);expect((await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers},env)).status).toBe(200);
   expect(fetcher.mock.calls.filter(([input])=>String(input)===jwksUrl)).toHaveLength(1);expect(fetcher.mock.calls.filter(([input])=>String(input)!==jwksUrl)).toHaveLength(2);
  } finally {await mf.dispose();}
 });

 it('fails closed before BPAD when runtime authentication configuration is incomplete',async()=>{
  const {mf,db}=await createTestDatabase(),fetcher=vi.fn();try{const app=createApp({fetch:fetcher,logger:{info:vi.fn(),error:vi.fn()}});const env:Bindings={NJKB_DB:db,AUTH_ISSUER:issuer};const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers:{'Cf-Access-Jwt-Assertion':'synthetic'}},env);expect(response.status).toBe(503);expect(fetcher).not.toHaveBeenCalled();}finally{await mf.dispose();}
 });

 it('integrates a real verified Access assertion through the private Hono route locally',async()=>{
  const {keys,auth}=await authenticator(),{mf,db}=await createTestDatabase();await seedMobilio2019(db);const logger:SafeLogger={info:vi.fn(),error:vi.fn()},fetchMock=vi.fn(async()=>jsonResponse(syntheticFullBpadRecord));
  try {
   const app=createApp({fetch:fetchMock,logger,privateAuthenticator:auth,rateLimiter:{check:()=>({allowed:true,retryAfterSeconds:0})}});const env:Bindings={NJKB_DB:db,BPAD_TIMEOUT_MS:'100',NJKB_RESOLUTION_AS_OF:'2026-09-20'};
   const response=await app.request('http://local/api/v1/vehicle/ZZ0001ZZ',{headers:{'Cf-Access-Jwt-Assertion':await sign(keys.pair.privateKey)}},env);const body=await response.json() as Record<string,unknown>;
   expect(response.status).toBe(200);expect(body).toMatchObject({status:'vehicle_found',vehicle_status:'found',njkb_status:'matched',vehicle:{brand:'HONDA'},njkb:{value:'150000000.00'}});expect(body).not.toHaveProperty('owner');expect((body.bpad as object)).not.toHaveProperty('raw');expect(fetchMock).toHaveBeenCalledOnce();
  } finally {await mf.dispose();}
 });
});
