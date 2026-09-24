export const DEFAULT_RATE_LIMIT_POLICY={limit:60,windowMs:60_000,maxEntries:10_000} as const;
export interface RateLimitDecision {
 allowed:boolean;
 retryAfterSeconds:number;
}

interface WindowEntry {count:number;resetAt:number}

export class FixedWindowRateLimiter {
 private readonly entries=new Map<string,WindowEntry>();
 constructor(private readonly options:{
  limit:number;
  windowMs:number;
  maxEntries:number;
  now?:()=>number;
 }) {
  if(options.limit<1||options.windowMs<1||options.maxEntries<1) throw new Error('Invalid rate limiter configuration');
 }
 check(key:string):RateLimitDecision {
  const now=(this.options.now??Date.now)();
  const current=this.entries.get(key);
  if(current&&current.resetAt>now) {
   if(current.count>=this.options.limit) return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((current.resetAt-now)/1000))};
   current.count++;
   return {allowed:true,retryAfterSeconds:0};
  }
  if(current) this.entries.delete(key);
  this.removeExpired(now);
  while(this.entries.size>=this.options.maxEntries) {
   const oldest=this.entries.keys().next().value as string|undefined;
   if(oldest===undefined) break;
   this.entries.delete(oldest);
  }
  this.entries.set(key,{count:1,resetAt:now+this.options.windowMs});
  return {allowed:true,retryAfterSeconds:0};
 }
 get size():number {return this.entries.size;}
 private removeExpired(now:number):void {
  for(const [key,entry] of this.entries) if(entry.resetAt<=now) this.entries.delete(key);
 }
}
