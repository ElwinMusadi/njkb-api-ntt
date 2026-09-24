import {authorize,type AuthPrincipal,type GranularPrivateScope} from './contracts';
import {AuthenticationError} from './jwt';
import type {RequestAuthenticator} from './request';
import {privateError,type PrivateErrorResponse} from '../private-api/contracts';

export type AuthenticationGateResult=
 |{authenticated:true;principal:AuthPrincipal}
 |{authenticated:false;httpStatus:401|503;body:PrivateErrorResponse};
export type AuthorizationGateResult=
 |{authorized:true;principal:AuthPrincipal;effectiveScopes:ReadonlySet<GranularPrivateScope>}
 |{authorized:false;httpStatus:403;body:PrivateErrorResponse};

export async function authenticateRequest(request:Request,authenticator:RequestAuthenticator,requestId:string):Promise<AuthenticationGateResult> {
 try{return {authenticated:true,principal:await authenticator.authenticate(request)};}
 catch(error) {
  const unavailable=error instanceof AuthenticationError&&error.code==='auth_unavailable';
  return unavailable?{authenticated:false,httpStatus:503,body:privateError('internal_error','Layanan autentikasi tidak tersedia',requestId)}:
   {authenticated:false,httpStatus:401,body:privateError('unauthorized','Kredensial tidak valid',requestId)};
 }
}
export function authorizeRequest(principal:AuthPrincipal,requiredScopes:readonly GranularPrivateScope[],requestId:string):AuthorizationGateResult {
 const decision=authorize(principal,requiredScopes);
 return decision.allowed?{authorized:true,principal,effectiveScopes:decision.effectiveScopes}:
  {authorized:false,httpStatus:403,body:privateError('forbidden','Akses tidak diizinkan',requestId)};
}
