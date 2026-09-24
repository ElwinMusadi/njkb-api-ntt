import {z} from 'zod';
import {jwtContractSchema,parseScopeClaim,type AuthPrincipal,type JwtContractClaims} from './contracts';

export interface JwtVerifier {verify(token:string):Promise<AuthPrincipal>}
export interface JwtKeyResolver {resolve(kid:string,forceRefresh?:boolean):Promise<CryptoKey>}
export type AuthenticationErrorCode='unauthorized'|'auth_unavailable';
export class AuthenticationError extends Error {
 constructor(public readonly code:AuthenticationErrorCode){super(code==='unauthorized'?'Authentication failed':'Authentication service unavailable');this.name='AuthenticationError';}
}
export interface Rs256SignedTokenVerifierOptions {keys:JwtKeyResolver;maxTokenBytes?:number}
export interface Rs256JwtVerifierOptions extends Rs256SignedTokenVerifierOptions {issuer:string;audience:string;clockToleranceSeconds:number;now?:()=>number}
const jwtHeaderSchema=z.object({alg:z.literal('RS256'),kid:z.string().min(1).max(256),typ:z.string().optional()}).passthrough();

const decodeBase64Url=(value:string,maxBytes:number):Uint8Array=>{
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw new AuthenticationError('unauthorized');
 const normalized=value.replace(/-/g,'+').replace(/_/g,'/'),padded=normalized+'='.repeat((4-normalized.length%4)%4);
 let decoded:string;try{decoded=atob(padded);}catch{throw new AuthenticationError('unauthorized');}
 if(decoded.length>maxBytes)throw new AuthenticationError('unauthorized');const bytes=new Uint8Array(decoded.length);for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);return bytes;
};
const decodeJson=(segment:string,maxBytes:number):unknown=>{const bytes=decodeBase64Url(segment,maxBytes);try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AuthenticationError('unauthorized');}};
const exactAudience=(claim:JwtContractClaims['aud'],expected:string):boolean=>typeof claim==='string'?claim===expected:claim.includes(expected);
const buffer=(value:Uint8Array):ArrayBuffer=>new Uint8Array(value).buffer as ArrayBuffer;

export function extractBearerToken(headers:Headers):string {
 const value=headers.get('authorization');if(value===null)throw new AuthenticationError('unauthorized');
 const match=/^Bearer ([^\s,]+)$/i.exec(value.trim());if(!match)throw new AuthenticationError('unauthorized');return match[1];
}

export class Rs256SignedTokenVerifier {
 private readonly encoder=new TextEncoder();
 constructor(private readonly options:Rs256SignedTokenVerifierOptions) {}
 async verifyClaims(token:string):Promise<unknown> {
  if(this.encoder.encode(token).byteLength>(this.options.maxTokenBytes??64*1024))throw new AuthenticationError('unauthorized');
  const segments=token.split('.');if(segments.length!==3||segments.some(segment=>segment===''))throw new AuthenticationError('unauthorized');
  const header=jwtHeaderSchema.safeParse(decodeJson(segments[0],4*1024));if(!header.success)throw new AuthenticationError('unauthorized');
  const claims=decodeJson(segments[1],32*1024),signature=decodeBase64Url(segments[2],8*1024),signed=this.encoder.encode(`${segments[0]}.${segments[1]}`);
  let key:CryptoKey;try{key=await this.options.keys.resolve(header.data.kid);}catch(error){if(error instanceof AuthenticationError)throw error;throw new AuthenticationError('auth_unavailable');}
  let verified=false;try{verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,buffer(signature),buffer(signed));}catch{throw new AuthenticationError('unauthorized');}
  if(!verified) {
   try{key=await this.options.keys.resolve(header.data.kid,true);verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,buffer(signature),buffer(signed));}catch(error){if(error instanceof AuthenticationError)throw error;throw new AuthenticationError('auth_unavailable');}
  }
  if(!verified)throw new AuthenticationError('unauthorized');return claims;
 }
}

export class Rs256JwtVerifier implements JwtVerifier {
 private readonly signed:Rs256SignedTokenVerifier;
 constructor(private readonly options:Rs256JwtVerifierOptions) {
  let protocol='';try{protocol=new URL(options.issuer).protocol;}catch{}
  if(protocol!=='https:'||options.audience.trim()===''||!Number.isInteger(options.clockToleranceSeconds)||options.clockToleranceSeconds<0||options.clockToleranceSeconds>60)throw new Error('Invalid JWT verifier configuration');
  this.signed=new Rs256SignedTokenVerifier(options);
 }
 async verify(token:string):Promise<AuthPrincipal> {
  const claimsResult=jwtContractSchema.safeParse(await this.signed.verifyClaims(token));if(!claimsResult.success)throw new AuthenticationError('unauthorized');
  const claims=claimsResult.data;if(claims.iss!==this.options.issuer||!exactAudience(claims.aud,this.options.audience))throw new AuthenticationError('unauthorized');
  const now=Math.floor((this.options.now??Date.now)()/1000),tolerance=this.options.clockToleranceSeconds;
  if(claims.exp<=now-tolerance||(claims.nbf!==undefined&&claims.nbf>now+tolerance))throw new AuthenticationError('unauthorized');
  let scopes;try{scopes=parseScopeClaim(claims.scope);}catch{throw new AuthenticationError('unauthorized');}
  return {subject:claims.sub,issuer:claims.iss,audience:typeof claims.aud==='string'?[claims.aud]:[...claims.aud],scopes,expiresAt:claims.exp,notBefore:claims.nbf??null};
 }
}
