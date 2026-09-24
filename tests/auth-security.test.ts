import {describe,expect,it,vi} from 'vitest';
import {authorize,expandScopes} from '../src/auth/contracts';
import {authenticateRequest,authorizeRequest} from '../src/auth/http';
import {AuthenticationError,Rs256JwtVerifier,extractBearerToken} from '../src/auth/jwt';
import {HttpsJwksKeyResolver} from '../src/auth/jwks';
import {BearerJwtRequestAuthenticator} from '../src/auth/request';

const issuer='https://issuer.synthetic.invalid';const audience='njkb-private-api';const requestId='00000000-0000-4000-8000-000000000000';
const b64=(value:Uint8Array|string):string=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');};
const keys=async(kid='synthetic-key')=>{const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']) as CryptoKeyPair;const exported=await crypto.subtle.exportKey('jwk',pair.publicKey);return {kid,pair,jwk:{kty:'RSA',n:exported.n!,e:exported.e!,kid,alg:'RS256',use:'sig',key_ops:['verify']} as JsonWebKey&{kid:string}};};
const sign=async(privateKey:CryptoKey,claims:Record<string,unknown>,header:Record<string,unknown>={alg:'RS256',kid:'synthetic-key',typ:'JWT'})=>{const encodedHeader=b64(JSON.stringify(header)),encodedPayload=b64(JSON.stringify(claims));const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));return `${encodedHeader}.${encodedPayload}.${b64(new Uint8Array(signature))}`;};
const claims=(overrides:Record<string,unknown>={})=>({sub:'synthetic-service',iss:issuer,aud:audience,exp:2_000_000_000,nbf:1_000_000_000,scope:'vehicle:read njkb:read',provider_extra:'accepted',...overrides});
const verifierWith=async(options:{jwk?:JsonWebKey&{kid:string};pair?:CryptoKeyPair;now?:number;fetch?:typeof fetch;minRefreshIntervalMs?:number}={})=>{const generated=options.pair&&options.jwk?{pair:options.pair,jwk:options.jwk}:await keys();const fetcher=options.fetch??vi.fn(async()=>new Response(JSON.stringify({keys:[generated.jwk]}),{status:200,headers:{'content-type':'application/json'}}));const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',fetch:fetcher,cacheTtlMs:60_000,minRefreshIntervalMs:options.minRefreshIntervalMs??1_000,timeoutMs:500,now:()=>options.now??1_500_000_000_000});return {generated,fetcher,resolver,verifier:new Rs256JwtVerifier({issuer,audience,clockToleranceSeconds:30,keys:resolver,now:()=>options.now??1_500_000_000_000})};};

describe('provider-neutral RS256 JWT authentication',()=>{
 it('extracts only one non-empty Bearer credential from Authorization',()=>{
  expect(extractBearerToken(new Headers({authorization:'Bearer abc.def.ghi'}))).toBe('abc.def.ghi');expect(extractBearerToken(new Headers({AUTHORIZATION:'bearer token'}))).toBe('token');
  for(const value of [undefined,'','Basic abc','Bearer','Bearer ','Bearer one two','Bearer one,two'])expect(()=>extractBearerToken(new Headers(value===undefined?{}:{authorization:value}))).toThrow(AuthenticationError);
 });

 it('verifies signature, exact issuer/audience, time, extra provider claims, and normalized scopes',async()=>{
  const {generated,verifier}=await verifierWith();const token=await sign(generated.pair.privateKey,claims());const principal=await verifier.verify(token);
  expect(principal).toMatchObject({subject:'synthetic-service',issuer,audience:[audience],expiresAt:2_000_000_000,notBefore:1_000_000_000});expect([...principal.scopes]).toEqual(['vehicle:read','njkb:read']);
 });

 it.each([
  ['wrong issuer',{iss:'https://other.synthetic.invalid'}],['wrong audience',{aud:'other-api'}],['expired',{exp:1_499_999_900}],['future nbf',{nbf:1_500_000_100}],['missing exp',{exp:undefined}],['malformed scope',{scope:{admin:true}}],['unknown scope',{scope:'vehicle:read root:all'}]
 ])('rejects %s',async(_label,overrides)=>{
  const {generated,verifier}=await verifierWith();const value=claims(overrides);if('exp' in overrides&&overrides.exp===undefined)delete (value as Record<string,unknown>).exp;
  await expect(verifier.verify(await sign(generated.pair.privateKey,value))).rejects.toMatchObject({code:'unauthorized'});
 });

 it('rejects invalid signature, alg none, unexpected algorithm, malformed structure, and oversized token',async()=>{
  const {generated,verifier}=await verifierWith();const other=await keys();await expect(verifier.verify(await sign(other.pair.privateKey,claims()))).rejects.toMatchObject({code:'unauthorized'});
  const none=`${b64(JSON.stringify({alg:'none',kid:'synthetic-key'}))}.${b64(JSON.stringify(claims()))}.x`;await expect(verifier.verify(none)).rejects.toMatchObject({code:'unauthorized'});
  const ps=await sign(generated.pair.privateKey,claims(),{alg:'PS256',kid:'synthetic-key'});await expect(verifier.verify(ps)).rejects.toMatchObject({code:'unauthorized'});
  await expect(verifier.verify('not-a-jwt')).rejects.toMatchObject({code:'unauthorized'});await expect(verifier.verify('a'.repeat(70_000))).rejects.toMatchObject({code:'unauthorized'});
 });

 it('applies only the configured small clock tolerance to exp and nbf',async()=>{
  const {generated,verifier}=await verifierWith();const now=1_500_000_000;
  await expect(verifier.verify(await sign(generated.pair.privateKey,claims({exp:now-29,nbf:now+29})))).resolves.toBeDefined();
  await expect(verifier.verify(await sign(generated.pair.privateKey,claims({exp:now-30})))).rejects.toMatchObject({code:'unauthorized'});
  await expect(verifier.verify(await sign(generated.pair.privateKey,claims({nbf:now+31})))).rejects.toMatchObject({code:'unauthorized'});
 });

 it('never lets attacker-controlled jku select the JWKS endpoint',async()=>{
  const generated=await keys(),fetcher=vi.fn(async(input:RequestInfo|URL)=>{expect(String(input)).toBe('https://jwks.synthetic.invalid/keys');return new Response(JSON.stringify({keys:[generated.jwk]}));});
  const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',fetch:fetcher,minRefreshIntervalMs:1_000});const verifier=new Rs256JwtVerifier({issuer,audience,clockToleranceSeconds:30,keys:resolver,now:()=>1_500_000_000_000});
  const token=await sign(generated.pair.privateKey,claims(),{alg:'RS256',kid:generated.kid,jku:'https://attacker.invalid/jwks'});
  await expect(verifier.verify(token)).resolves.toBeDefined();expect(fetcher).toHaveBeenCalledOnce();
 });

 it('accepts audience arrays only when an exact expected audience is present',async()=>{
  const {generated,verifier}=await verifierWith();await expect(verifier.verify(await sign(generated.pair.privateKey,claims({aud:['other',audience]})))).resolves.toMatchObject({audience:['other',audience]});
  await expect(verifier.verify(await sign(generated.pair.privateKey,claims({aud:['prefix-'+audience]})))).rejects.toMatchObject({code:'unauthorized'});
 });
});

describe('trusted bounded JWKS resolution',()=>{
 it('requires configured HTTPS URL and rejects invalid resolver bounds',()=>{
  expect(()=>new HttpsJwksKeyResolver({jwksUrl:'http://jwks.invalid/keys'})).toThrow('HTTPS');expect(()=>new HttpsJwksKeyResolver({jwksUrl:'https://jwks.invalid/keys',maxKeys:0})).toThrow('Invalid');
 });

 it('accepts the documented Cloudflare JWKS envelope while keeping key validation strict',async()=>{
  const generated=await keys(),cloudflareShape={keys:[generated.jwk],public_cert:{kid:generated.kid,cert:'SYNTHETIC-CERT-CURRENT'},public_certs:[{kid:generated.kid,cert:'SYNTHETIC-CERT-CURRENT'}]};
  const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://team.synthetic.cloudflareaccess.com/cdn-cgi/access/certs',fetch:vi.fn(async()=>new Response(JSON.stringify(cloudflareShape)))});
  await expect(resolver.resolve(generated.kid)).resolves.toBeInstanceOf(CryptoKey);
 });

 it('rejects undocumented JWKS envelope fields and malformed certificate metadata',async()=>{
  const generated=await keys();
  for(const payload of [{keys:[generated.jwk],unexpected:'value'},{keys:[generated.jwk],public_cert:{kid:generated.kid,cert:123}}]) {
   const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://team.synthetic.cloudflareaccess.com/cdn-cgi/access/certs',fetch:vi.fn(async()=>new Response(JSON.stringify(payload)))});
   await expect(resolver.resolve(generated.kid)).rejects.toMatchObject({code:'auth_unavailable'});
  }
 });

 it('uses kid-aware bounded cache and does not refetch immediately for random unknown kids',async()=>{
  const generated=await keys();const fetcher=vi.fn(async()=>new Response(JSON.stringify({keys:[generated.jwk]})));let now=1_500_000_000_000;
  const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',fetch:fetcher,cacheTtlMs:60_000,minRefreshIntervalMs:30_000,now:()=>now});
  await resolver.resolve(generated.kid);await resolver.resolve(generated.kid);expect(fetcher).toHaveBeenCalledOnce();
  await expect(resolver.resolve('attacker-random-kid')).rejects.toMatchObject({code:'unauthorized'});expect(fetcher).toHaveBeenCalledOnce();
  now+=31_000;await expect(resolver.resolve('attacker-random-kid')).rejects.toMatchObject({code:'unauthorized'});expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it('refreshes a rotated same-kid key after cooldown and verifies the new signature',async()=>{
  const first=await keys(),second=await keys(first.kid);let current=first.jwk,now=1_500_000_000_000;const fetcher=vi.fn(async()=>new Response(JSON.stringify({keys:[current]})));
  const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',fetch:fetcher,cacheTtlMs:60_000,minRefreshIntervalMs:1_000,now:()=>now});const verifier=new Rs256JwtVerifier({issuer,audience,clockToleranceSeconds:30,keys:resolver,now:()=>now});
  await expect(verifier.verify(await sign(first.pair.privateKey,claims()))).resolves.toBeDefined();current=second.jwk;now+=1_001;
  await expect(verifier.verify(await sign(second.pair.privateKey,claims()))).resolves.toBeDefined();expect(fetcher).toHaveBeenCalledTimes(2);
 });

 it.each([
  ['malformed JSON',()=>new Response('{broken')],['too many keys',async()=>{const one=await keys();return new Response(JSON.stringify({keys:Array.from({length:17},()=>one.jwk)}));}],['duplicate kid',async()=>{const one=await keys();return new Response(JSON.stringify({keys:[one.jwk,one.jwk]}));}],['wrong key type',()=>new Response(JSON.stringify({keys:[{kid:'x',kty:'oct',k:'abc',alg:'RS256'}]}))],['algorithm mismatch',async()=>{const one=await keys();return new Response(JSON.stringify({keys:[{...one.jwk,alg:'PS256'}]}));}],['wrong key operations',async()=>{const one=await keys();return new Response(JSON.stringify({keys:[{...one.jwk,key_ops:['sign']}]}));}],['unknown JWK field',async()=>{const one=await keys();return new Response(JSON.stringify({keys:[{...one.jwk,unexpected:'value'}]}));}],['private key material',async()=>{const one=await keys();return new Response(JSON.stringify({keys:[{...one.jwk,d:'private'}]}));}],['HTTP error',()=>new Response('down',{status:503})]
 ])('fails closed for %s JWKS',async(_label,responseFactory)=>{
  const resolver=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',fetch:vi.fn(async()=>responseFactory())});await expect(resolver.resolve('x')).rejects.toBeInstanceOf(AuthenticationError);
 });

 it('rejects oversized and stalled JWKS responses without logging body or key material',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
   const oversized=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',maxResponseBytes:1024,fetch:vi.fn(async()=>new Response('SYNTHETIC SECRET'.repeat(100),{headers:{'content-length':'99999'}}))});await expect(oversized.resolve('x')).rejects.toMatchObject({code:'auth_unavailable'});
   const stalled=new HttpsJwksKeyResolver({jwksUrl:'https://jwks.synthetic.invalid/keys',timeoutMs:100,fetch:vi.fn(async()=>new Response(new ReadableStream({start(){}})))});await expect(stalled.resolve('x')).rejects.toMatchObject({code:'auth_unavailable'});
   expect(JSON.stringify([...log.mock.calls,...error.mock.calls])).not.toContain('SYNTHETIC SECRET');
  } finally {log.mockRestore();error.mockRestore();}
 });
});

describe('HTTP authentication and authorization bridge',()=>{
 it('returns safe 401 for missing/malformed/invalid credentials without calling protected business logic',async()=>{
  const verifier={verify:vi.fn(async()=>{throw new AuthenticationError('unauthorized');})};const protectedLogic=vi.fn();
  for(const header of [undefined,'Basic x','Bearer']) {
   const result=await authenticateRequest(new Request('https://private.invalid/api/v1/vehicle/ZZ0001ZZ',{headers:header?{authorization:header}:{}}),new BearerJwtRequestAuthenticator(verifier),requestId);
   expect(result).toMatchObject({authenticated:false,httpStatus:401,body:{status:'unauthorized',error:{code:'unauthorized',request_id:requestId}}});
   if(result.authenticated)protectedLogic();
  }
  expect(protectedLogic).not.toHaveBeenCalled();expect(verifier.verify).not.toHaveBeenCalled();
 });

 it('returns safe 503 for trusted JWKS/provider unavailability without leaking details',async()=>{
  const verifier={verify:vi.fn(async()=>{throw new AuthenticationError('auth_unavailable');})};const result=await authenticateRequest(new Request('https://private.invalid/',{headers:{authorization:'Bearer synthetic-token'}}),new BearerJwtRequestAuthenticator(verifier),requestId);
  expect(result).toMatchObject({authenticated:false,httpStatus:503,body:{status:'error',error:{code:'internal_error'}}});expect(JSON.stringify(result)).not.toMatch(/synthetic-token|JWKS|signature|key/);
 });

 it('distinguishes authenticated-but-forbidden 403 from unauthorized 401 and reuses scope expansion',async()=>{
  const generated=await keys();const resolver={resolve:vi.fn(async()=>generated.pair.publicKey)};const verifier=new Rs256JwtVerifier({issuer,audience,clockToleranceSeconds:30,keys:resolver,now:()=>1_500_000_000_000});
  const token=await sign(generated.pair.privateKey,claims({scope:'vehicle:read'}));const auth=await authenticateRequest(new Request('https://private.invalid/',{headers:{authorization:`Bearer ${token}`}}),new BearerJwtRequestAuthenticator(verifier),requestId);
  expect(auth.authenticated).toBe(true);if(!auth.authenticated)throw new Error('unexpected');
  expect(authorizeRequest(auth.principal,['vehicle:read'],requestId)).toMatchObject({authorized:true});
  expect(authorizeRequest(auth.principal,['registration:read'],requestId)).toMatchObject({authorized:false,httpStatus:403,body:{status:'forbidden',error:{code:'forbidden'}}});
  expect(authorize(auth.principal,['bpad:raw']).allowed).toBe(false);
 });

 it('preserves registration:read breadth, bpad:raw separation, and vehicle:full bundle',()=>{
  const base={subject:'synthetic',issuer,audience:[audience],expiresAt:2_000_000_000,notBefore:null} as const;
  const registration={...base,scopes:new Set(['vehicle:read','registration:read'] as const)};const reg=authorize(registration,['registration:read']);expect(reg.allowed).toBe(true);if(reg.allowed){expect(reg.effectiveScopes.has('bpad:raw')).toBe(false);expect(reg.effectiveScopes.has('owner:read')).toBe(false);}
  const raw={...base,scopes:new Set(['vehicle:read','bpad:raw'] as const)};expect(authorize(raw,['bpad:raw']).allowed).toBe(true);expect(authorize(raw,['registration:read']).allowed).toBe(false);
  const full={...base,scopes:new Set(['vehicle:full'] as const)};const decision=authorize(full,['vehicle:read','registration:read','tax:read','owner:read','njkb:read','bpad:raw']);expect(decision.allowed).toBe(true);expect([...expandScopes(full.scopes)]).toHaveLength(6);
 });

 it('does not log Authorization, JWT claims, or private data',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});const secret='synthetic.jwt.secret';
  try {await authenticateRequest(new Request('https://private.invalid/',{headers:{authorization:`Bearer ${secret}`}}),new BearerJwtRequestAuthenticator({verify:vi.fn(async()=>{throw new AuthenticationError('unauthorized');})}),requestId);
   expect(JSON.stringify([...log.mock.calls,...error.mock.calls])).not.toMatch(/synthetic\.jwt\.secret|TEST OWNER|NoKTP|Authorization/);
  } finally {log.mockRestore();error.mockRestore();}
 });
});
