import {extractBearerToken,type JwtVerifier} from './jwt';
import type {AuthPrincipal} from './contracts';

export interface RequestAuthenticator {authenticate(request:Request):Promise<AuthPrincipal>}
export class BearerJwtRequestAuthenticator implements RequestAuthenticator {
 constructor(private readonly verifier:JwtVerifier) {}
 authenticate(request:Request):Promise<AuthPrincipal> {return this.verifier.verify(extractBearerToken(request.headers));}
}
