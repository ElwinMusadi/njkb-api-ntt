import {CloudflareAccessServiceAuthenticator,parseAccessServiceConfiguration} from './access';
import {HttpsJwksKeyResolver,type JwksFetcher} from './jwks';
import type {RequestAuthenticator} from './request';

export interface AccessRuntimeBindings {
 AUTH_ISSUER?:string;AUTH_AUDIENCE?:string;AUTH_JWKS_URL?:string;AUTH_ACCESS_GRANTS_JSON?:string;AUTH_CLOCK_TOLERANCE_SECONDS?:string;
}
export function createAccessAuthenticatorFromBindings(bindings:AccessRuntimeBindings,fetcher?:JwksFetcher):RequestAuthenticator|null {
 const values=[bindings.AUTH_ISSUER,bindings.AUTH_AUDIENCE,bindings.AUTH_JWKS_URL,bindings.AUTH_ACCESS_GRANTS_JSON,bindings.AUTH_CLOCK_TOLERANCE_SECONDS];
 if(values.every(value=>value===undefined))return null;
 if(values.some(value=>value===undefined))throw new Error('Incomplete Cloudflare Access authentication configuration');
 const config=parseAccessServiceConfiguration({issuer:bindings.AUTH_ISSUER,audience:bindings.AUTH_AUDIENCE,jwksUrl:bindings.AUTH_JWKS_URL,grantsJson:bindings.AUTH_ACCESS_GRANTS_JSON,clockToleranceSeconds:bindings.AUTH_CLOCK_TOLERANCE_SECONDS});
 const keys=new HttpsJwksKeyResolver({jwksUrl:config.jwksUrl,fetch:fetcher});
 return new CloudflareAccessServiceAuthenticator({...config,keys});
}
