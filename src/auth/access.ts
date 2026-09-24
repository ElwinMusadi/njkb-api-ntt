import {z} from 'zod';
import {parseScopeClaim,type AuthPrincipal,type PrivateScope} from './contracts';
import {AuthenticationError,Rs256SignedTokenVerifier,type JwtKeyResolver} from './jwt';
import type {RequestAuthenticator} from './request';

export const APPROVED_AUTH_CLOCK_TOLERANCE_SECONDS=30 as const;
export interface AccessServiceGrant {accessCommonName:string;principal:string;scopes:ReadonlySet<PrivateScope>}
export interface AccessServiceAuthenticatorOptions {issuer:string;audience:string;clockToleranceSeconds:number;keys:JwtKeyResolver;grants:readonly AccessServiceGrant[];now?:()=>number;maxTokenBytes?:number}
export interface AccessServiceConfigurationInput {issuer:unknown;audience:unknown;jwksUrl:unknown;clockToleranceSeconds:unknown;grantsJson:unknown}
export interface AccessServiceConfiguration {issuer:string;audience:string;jwksUrl:string;clockToleranceSeconds:number;grants:readonly AccessServiceGrant[]}
const accessClaimsSchema=z.object({type:z.literal('app'),iss:z.string().url().max(2048),aud:z.union([z.string().min(1).max(512),z.array(z.string().min(1).max(512)).min(1).max(16)]),exp:z.number().int().positive(),nbf:z.number().int().nonnegative().optional(),common_name:z.string().min(1).max(256),sub:z.string().max(256).optional()}).passthrough();
const grantInputSchema=z.array(z.object({access_common_name:z.string().min(1).max(256),principal:z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),scopes:z.union([z.string().min(1),z.array(z.string().min(1)).min(1)])}).strict()).min(1).max(256);
const https=(value:unknown,name:string):string=>{const parsed=z.string().url().max(2048).parse(value);if(new URL(parsed).protocol!=='https:')throw new Error(`${name} must use HTTPS`);return parsed.replace(/\/$/,'');};
const hasAudience=(claim:string|readonly string[],expected:string):boolean=>typeof claim==='string'?claim===expected:claim.includes(expected);

export function parseAccessServiceConfiguration(input:AccessServiceConfigurationInput):AccessServiceConfiguration {
 const issuer=https(input.issuer,'AUTH_ISSUER'),jwksUrl=https(input.jwksUrl,'AUTH_JWKS_URL'),audience=z.string().min(1).max(512).parse(input.audience),clockToleranceSeconds=z.coerce.number().int().min(0).max(60).parse(input.clockToleranceSeconds);
 let raw:unknown;try{raw=JSON.parse(z.string().min(2).parse(input.grantsJson));}catch{throw new Error('AUTH_ACCESS_GRANTS_JSON must be valid JSON');}
 const parsed=grantInputSchema.parse(raw),commonNames=new Set<string>(),principals=new Set<string>(),grants:AccessServiceGrant[]=[];
 for(const item of parsed) {
  if(commonNames.has(item.access_common_name)||principals.has(item.principal))throw new Error('Access grant principals and common names must be unique');
  const scopes=parseScopeClaim(item.scopes);if(!scopes.has('vehicle:read')&&!scopes.has('vehicle:full'))throw new Error('Every Access grant must include vehicle:read or vehicle:full');
  commonNames.add(item.access_common_name);principals.add(item.principal);grants.push({accessCommonName:item.access_common_name,principal:item.principal,scopes});
 }
 return {issuer,audience,jwksUrl,clockToleranceSeconds,grants:Object.freeze(grants)};
}

export class CloudflareAccessServiceAuthenticator implements RequestAuthenticator {
 private readonly signed:Rs256SignedTokenVerifier;private readonly grants:ReadonlyMap<string,AccessServiceGrant>;
 constructor(private readonly options:AccessServiceAuthenticatorOptions) {
  let protocol='';try{protocol=new URL(options.issuer).protocol;}catch{}
  if(protocol!=='https:'||options.audience.trim()===''||!Number.isInteger(options.clockToleranceSeconds)||options.clockToleranceSeconds<0||options.clockToleranceSeconds>60||options.grants.length===0)throw new Error('Invalid Cloudflare Access authenticator configuration');
  const grants=new Map<string,AccessServiceGrant>();for(const grant of options.grants){if(grants.has(grant.accessCommonName))throw new Error('Duplicate Cloudflare Access common_name');grants.set(grant.accessCommonName,grant);}this.grants=grants;
  this.signed=new Rs256SignedTokenVerifier(options);
 }
 async authenticate(request:Request):Promise<AuthPrincipal> {
  const token=request.headers.get('cf-access-jwt-assertion');if(token===null||token.trim()===''||/[\s,]/.test(token))throw new AuthenticationError('unauthorized');
  const parsed=accessClaimsSchema.safeParse(await this.signed.verifyClaims(token));if(!parsed.success)throw new AuthenticationError('unauthorized');const claims=parsed.data;
  if(claims.iss.replace(/\/$/,'')!==this.options.issuer.replace(/\/$/,'')||!hasAudience(claims.aud,this.options.audience))throw new AuthenticationError('unauthorized');
  const now=Math.floor((this.options.now??Date.now)()/1000),tolerance=this.options.clockToleranceSeconds;if(claims.exp<=now-tolerance||(claims.nbf!==undefined&&claims.nbf>now+tolerance))throw new AuthenticationError('unauthorized');
  const grant=this.grants.get(claims.common_name);if(!grant)throw new AuthenticationError('unauthorized');
  return {subject:grant.principal,issuer:claims.iss,audience:typeof claims.aud==='string'?[claims.aud]:[...claims.aud],scopes:grant.scopes,expiresAt:claims.exp,notBefore:claims.nbf??null};
 }
}
