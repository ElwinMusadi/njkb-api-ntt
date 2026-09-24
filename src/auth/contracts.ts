import {z} from 'zod';

export const granularPrivateScopes=['vehicle:read','registration:read','tax:read','owner:read','njkb:read','bpad:raw'] as const;
export const privateScopes=[...granularPrivateScopes,'vehicle:full'] as const;
export type GranularPrivateScope=typeof granularPrivateScopes[number];
export type PrivateScope=typeof privateScopes[number];

export const vehicleFullBundle:ReadonlySet<GranularPrivateScope>=new Set(granularPrivateScopes);
export function expandScopes(scopes:Iterable<PrivateScope>):ReadonlySet<GranularPrivateScope> {
 const expanded=new Set<GranularPrivateScope>();
 for(const scope of scopes) {
  if(scope==='vehicle:full') for(const bundled of vehicleFullBundle) expanded.add(bundled);
  else expanded.add(scope);
 }
 return expanded;
}

export interface AuthPrincipal {
 subject:string;
 issuer:string;
 audience:readonly string[];
 scopes:ReadonlySet<PrivateScope>;
 expiresAt:number;
 notBefore:number|null;
}
export const jwtContractSchema=z.object({
 sub:z.string().min(1).max(256),iss:z.string().url().max(2048),aud:z.union([z.string().min(1).max(512),z.array(z.string().min(1).max(512)).min(1).max(16)]),
 exp:z.number().int().positive(),nbf:z.number().int().nonnegative().optional(),scope:z.union([z.string().min(1).max(1024),z.array(z.string().min(1).max(128)).min(1).max(32)])
}).passthrough();
export type JwtContractClaims=z.infer<typeof jwtContractSchema>;
const supportedScopeSet:ReadonlySet<string>=new Set(privateScopes);
export function parseScopeClaim(claim:JwtContractClaims['scope']):ReadonlySet<PrivateScope> {
 const values=typeof claim==='string'?claim.split(/\s+/).filter(Boolean):claim;
 const unknown=values.filter(value=>!supportedScopeSet.has(value));if(unknown.length)throw new Error(`Unsupported private API scope: ${unknown.join(',')}`);
 return new Set(values as PrivateScope[]);
}

export type AuthorizationDecision=
 |{allowed:true;effectiveScopes:ReadonlySet<GranularPrivateScope>}
 |{allowed:false;code:'insufficient_scope';missingScopes:readonly GranularPrivateScope[]};
export function authorize(principal:AuthPrincipal,requiredScopes:readonly GranularPrivateScope[]):AuthorizationDecision {
 const effectiveScopes=expandScopes(principal.scopes);
 const missingScopes=requiredScopes.filter(scope=>!effectiveScopes.has(scope));
 return missingScopes.length===0?{allowed:true,effectiveScopes}:{allowed:false,code:'insufficient_scope',missingScopes};
}

export interface AuthConfigurationContract {
 issuer:string; // AUTH_ISSUER — not established in this phase
 audience:string; // AUTH_AUDIENCE — not established in this phase
 jwksUrl:string; // AUTH_JWKS_URL — trusted configuration, never token-derived
 allowedAlgorithms:readonly 'RS256'[];
 clockToleranceSeconds:number;
}

export const authenticationFoundation={
 scheme:'Bearer JWT',issuerConfig:'AUTH_ISSUER',audienceConfig:'AUTH_AUDIENCE',jwksUrlConfig:'AUTH_JWKS_URL',allowedAlgorithms:['RS256'] as const,
 validationRequirements:['signature','issuer','audience','exp','nbf_when_present','algorithm_allowlist','token_structure'] as const,
 cryptographicVerifierImplemented:true,accessProviderSelected:true,productionProviderConfigured:false,middlewareAttached:true,privateRouteActive:false
} as const;
