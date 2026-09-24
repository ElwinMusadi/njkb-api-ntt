import {z} from 'zod';
import {AuthenticationError,type JwtKeyResolver} from './jwt';

export type JwksFetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export interface JwksResolverOptions {jwksUrl:string;fetch?:JwksFetcher;cacheTtlMs?:number;minRefreshIntervalMs?:number;timeoutMs?:number;maxResponseBytes?:number;maxKeys?:number;now?:()=>number}
const jwkSchema=z.object({kid:z.string().min(1).max(256),kty:z.literal('RSA'),n:z.string().min(1),e:z.string().min(1),alg:z.literal('RS256').optional(),use:z.literal('sig').optional(),key_ops:z.array(z.string()).optional(),d:z.never().optional()}).strict();
const certificateSchema=z.object({kid:z.string().min(1).max(256),cert:z.string().min(1)}).strict();
const jwksSchema=(maxKeys:number)=>z.object({keys:z.array(jwkSchema).max(maxKeys),public_cert:certificateSchema.optional(),public_certs:z.array(certificateSchema).max(maxKeys).optional()}).strict();

async function readWithAbort(reader:ReadableStreamDefaultReader<Uint8Array>,signal:AbortSignal):Promise<ReadableStreamReadResult<Uint8Array>> {
 if(signal.aborted)throw new AuthenticationError('auth_unavailable');
 return new Promise((resolve,reject)=>{const abort=()=>reject(new AuthenticationError('auth_unavailable'));signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function boundedText(response:Response,maxBytes:number,signal:AbortSignal):Promise<string> {
 const length=response.headers.get('content-length');if(length&&/^\d+$/.test(length)&&Number(length)>maxBytes)throw new AuthenticationError('auth_unavailable');
 if(response.body===null)throw new AuthenticationError('auth_unavailable');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try {
  while(true) {
   if(signal.aborted)throw new AuthenticationError('auth_unavailable');
   const {done,value}=await readWithAbort(reader,signal);if(done)break;if(value===undefined)continue;size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();throw new AuthenticationError('auth_unavailable');}chunks.push(value);
  }
 } catch(error) {await reader.cancel().catch(()=>undefined);if(error instanceof AuthenticationError)throw error;throw new AuthenticationError('auth_unavailable');}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(result);
}

export class HttpsJwksKeyResolver implements JwtKeyResolver {
 private cache=new Map<string,{key:CryptoKey;expiresAt:number}>();private refreshPromise:Promise<void>|null=null;private lastRefreshAt:number|null=null;
 private readonly fetcher:JwksFetcher;private readonly ttl:number;private readonly minRefreshInterval:number;private readonly timeout:number;private readonly maxBytes:number;private readonly maxKeys:number;private readonly now:()=>number;
 constructor(private readonly options:JwksResolverOptions) {
  const url=new URL(options.jwksUrl);if(url.protocol!=='https:')throw new Error('JWKS URL must use HTTPS');
  this.fetcher=options.fetch??fetch;this.ttl=options.cacheTtlMs??5*60_000;this.minRefreshInterval=options.minRefreshIntervalMs??30_000;this.timeout=options.timeoutMs??2_000;this.maxBytes=options.maxResponseBytes??64*1024;this.maxKeys=options.maxKeys??16;this.now=options.now??Date.now;
  if(!Number.isInteger(this.ttl)||this.ttl<1_000||this.ttl>60*60_000||!Number.isInteger(this.minRefreshInterval)||this.minRefreshInterval<1_000||this.minRefreshInterval>this.ttl||!Number.isInteger(this.timeout)||this.timeout<100||this.timeout>10_000||!Number.isInteger(this.maxBytes)||this.maxBytes<1_024||this.maxBytes>1024*1024||!Number.isInteger(this.maxKeys)||this.maxKeys<1||this.maxKeys>64)throw new Error('Invalid JWKS resolver configuration');
 }
 async resolve(kid:string,forceRefresh=false):Promise<CryptoKey> {
  const now=this.now(),cached=this.cache.get(kid);if(!forceRefresh&&cached&&cached.expiresAt>now)return cached.key;
  if(this.lastRefreshAt!==null&&now-this.lastRefreshAt<this.minRefreshInterval) {
   if(cached&&cached.expiresAt>now)return cached.key;
   throw new AuthenticationError('unauthorized');
  }
  await this.refresh();const refreshed=this.cache.get(kid);if(!refreshed||refreshed.expiresAt<=this.now())throw new AuthenticationError('unauthorized');return refreshed.key;
 }
 private async refresh():Promise<void> {
  if(this.refreshPromise!==null)return this.refreshPromise;
  this.refreshPromise=this.fetchKeys().finally(()=>{this.refreshPromise=null;});return this.refreshPromise;
 }
 private async fetchKeys():Promise<void> {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),this.timeout);
  try {
   let response:Response;try{response=await this.fetcher(this.options.jwksUrl,{headers:{accept:'application/json'},redirect:'error',signal:controller.signal});}catch{throw new AuthenticationError('auth_unavailable');}
   if(!response.ok)throw new AuthenticationError('auth_unavailable');const text=await boundedText(response,this.maxBytes,controller.signal);
   let json:unknown;try{json=JSON.parse(text);}catch{throw new AuthenticationError('auth_unavailable');}
   const parsed=jwksSchema(this.maxKeys).safeParse(json);if(!parsed.success)throw new AuthenticationError('auth_unavailable');
   const next=new Map<string,{key:CryptoKey;expiresAt:number}>(),expiresAt=this.now()+this.ttl;
   for(const jwk of parsed.data.keys) {
    if(next.has(jwk.kid)||jwk.alg!==undefined&&jwk.alg!=='RS256'||jwk.use!==undefined&&jwk.use!=='sig'||jwk.key_ops!==undefined&&!jwk.key_ops.includes('verify'))throw new AuthenticationError('auth_unavailable');
    let key:CryptoKey;try{key=await crypto.subtle.importKey('jwk',jwk as JsonWebKey,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);}catch{throw new AuthenticationError('auth_unavailable');}
    next.set(jwk.kid,{key,expiresAt});
   }
   this.cache=next;this.lastRefreshAt=this.now();
  } finally {clearTimeout(timeout);}
 }
}
