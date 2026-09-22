import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { BpadError, BpadVehicleAdapter, normalizeNopol, type Fetcher } from './bpad/adapter';
import { MatchAuditRepository, NjkbRepository } from './db/repository';
import { DatabaseError, MatchingError } from './errors';
import { formatLookupResponse } from './http/response';
import { FixedWindowRateLimiter, type RateLimitDecision } from './http/rate-limit';
import { NjkbMatchingEngine } from './matching/engine';
import { NjkbLookupService } from './matching/service';

export type Bindings={
 NJKB_DB:D1Database;
 BPAD_TIMEOUT_MS?:string;
 NJKB_RESOLUTION_AS_OF?:string;
 // Local integration testing can override this. Production uses the adapter default.
 BPAD_ENDPOINT?:string;
};
type Variables={requestId:string;startedAt:number};
type AppEnv={Bindings:Bindings;Variables:Variables};
export interface SafeLogger {
 info(event:Record<string,unknown>):void;
 error(event:Record<string,unknown>):void;
}
export interface RequestRateLimiter {check(key:string):RateLimitDecision}
export interface AppOptions {
 fetch?:Fetcher;
 logger?:SafeLogger;
 matcherFactory?:(db:D1Database)=>NjkbMatchingEngine;
 rateLimiter?:RequestRateLimiter;
}

const consoleLogger:SafeLogger={
 info:event=>console.log(JSON.stringify(event)),
 error:event=>console.error(JSON.stringify(event))
};

function timeoutMs(value:string|undefined):number {
 if(!value||!/^\d+$/.test(value)) return 5000;
 const parsed=Number(value);
 return parsed>=100&&parsed<=30000?parsed:5000;
}
function resolutionAsOf(value:string|undefined):string {
 if(value&&/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
 return new Date().toISOString().slice(0,10);
}
function sanitizedPath(path:string):string {
 if(path.startsWith('/api/njkb/')) return '/api/njkb/:nopol';
 if(path==='/health'||path==='/ready') return path;
 return 'unmatched_route';
}
function clientKey(c:Context<AppEnv>):string {
 const ip=c.req.header('CF-Connecting-IP');
 return ip&&ip.length<=64?`cf:${ip}`:'local:unknown';
}

export function createApp(options:AppOptions={}) {
 const app=new Hono<AppEnv>();
 const logger=options.logger??consoleLogger;
 const rateLimiter=options.rateLimiter??new FixedWindowRateLimiter({limit:60,windowMs:60_000,maxEntries:10_000});

 app.use('*',async(c,next)=>{
  c.set('requestId',crypto.randomUUID());c.set('startedAt',Date.now());
  c.header('Cache-Control','no-store');c.header('X-Request-ID',c.get('requestId'));
  c.header('X-Content-Type-Options','nosniff');c.header('X-Frame-Options','DENY');
  c.header('Referrer-Policy','no-referrer');c.header('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  await next();
 });

 const respond=(c:Context<AppEnv>,body:Record<string,unknown>,status:ContentfulStatusCode,eventStatus:string)=>{
  logger.info({event:'http_request',request_id:c.get('requestId'),method:c.req.method,
   path:sanitizedPath(new URL(c.req.url).pathname),result:eventStatus,http_status:status,
   duration_ms:Date.now()-c.get('startedAt')});
  return c.json(body,status);
 };

 app.get('/health',c=>respond(c,{status:'ok'},200,'healthy'));
 app.get('/ready',async c=>{
  try {
   const ready=await c.env.NJKB_DB.prepare('SELECT 1 AS ready').first<{ready:number}>();
   if(ready?.ready!==1) throw new Error('D1 readiness query failed');
   return respond(c,{status:'ready'},200,'ready');
  } catch {
   return respond(c,{status:'unhealthy',error:{code:'database_unavailable',message:'Layanan belum siap',request_id:c.get('requestId')}},503,'database_unavailable');
  }
 });

 app.get('/api/njkb/:nopol',async c=>{
  const limit=rateLimiter.check(clientKey(c));
  if(!limit.allowed) {
   c.header('Retry-After',String(limit.retryAfterSeconds));
   return respond(c,{status:'invalid_request',error:{code:'rate_limit_exceeded',message:'Terlalu banyak permintaan',request_id:c.get('requestId')}},429,'rate_limit_exceeded');
  }
  if(new URL(c.req.url).searchParams.size>0) return respond(c,{status:'invalid_request',error:{code:'unsupported_query_parameter',
   message:'Endpoint ini tidak menerima parameter lookup; NJKB diresolusi berdasarkan tahun pembuatan kendaraan',request_id:c.get('requestId')}},400,'unsupported_query_parameter');

  let nopol:string;
  try {nopol=normalizeNopol(c.req.param('nopol'));}
  catch(error) {
   if(error instanceof BpadError) return respond(c,{status:'invalid_request',error:{code:'invalid_nopol',
    message:'Format NOPOL tidak valid',request_id:c.get('requestId')}},400,'invalid_nopol');
   throw error;
  }

  const adapter=new BpadVehicleAdapter({fetch:options.fetch,timeoutMs:timeoutMs(c.env.BPAD_TIMEOUT_MS),endpoint:c.env.BPAD_ENDPOINT});
  const matcher=options.matcherFactory?.(c.env.NJKB_DB)??
   new NjkbMatchingEngine(new NjkbRepository(c.env.NJKB_DB),new MatchAuditRepository(c.env.NJKB_DB));
  const detailed=await new NjkbLookupService(adapter,matcher).lookupDetailed(nopol,resolutionAsOf(c.env.NJKB_RESOLUTION_AS_OF));
  const formatted=formatLookupResponse({result:detailed.result,nopol,
   vehicle:detailed.context?.vehicle,requestId:c.get('requestId')});
  return respond(c,formatted.body,formatted.status,detailed.result.status);
 });

 app.notFound(c=>respond(c,{status:'error',error:{code:'route_not_found',message:'Route tidak ditemukan',
  request_id:c.get('requestId')}},404,'route_not_found'));

 app.onError((error,c)=>{
  const isDatabase=error instanceof DatabaseError;
  const isMatching=error instanceof MatchingError;
  const code=isDatabase?'database_error':isMatching?'matching_error':'internal_error';
  const status:500|503=isDatabase?503:500;
  logger.error({event:'http_error',request_id:c.get('requestId'),method:c.req.method,
   path:sanitizedPath(new URL(c.req.url).pathname),code,http_status:status,
   error_type:error instanceof Error?error.name:'unknown',duration_ms:Date.now()-c.get('startedAt')});
  return c.json({status:'error',error:{code,message:isDatabase?'Database referensi NJKB tidak tersedia':
   isMatching?'Proses matching NJKB gagal':'Terjadi kesalahan internal',request_id:c.get('requestId')}},status);
 });

 return app;
}

export default createApp();
