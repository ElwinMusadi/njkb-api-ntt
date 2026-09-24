import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_POLICY,FixedWindowRateLimiter } from '../src/http/rate-limit';

describe('fixed-window request rate limiter',()=>{
 it('enforces the approved production policy of 60 requests per 60 seconds per principal key',()=>{
  let now=100;const limiter=new FixedWindowRateLimiter({...DEFAULT_RATE_LIMIT_POLICY,now:()=>now});for(let request=1;request<=60;request++)expect(limiter.check('principal:canary').allowed).toBe(true);
  expect(limiter.check('principal:canary')).toEqual({allowed:false,retryAfterSeconds:60});expect(limiter.check('principal:other').allowed).toBe(true);
  now=60_101;expect(limiter.check('principal:canary').allowed).toBe(true);
 });
 it('allows requests below the threshold and blocks the next request',()=>{
  const limiter=new FixedWindowRateLimiter({limit:2,windowMs:1_000,maxEntries:10,now:()=>100});
  expect(limiter.check('a').allowed).toBe(true);
  expect(limiter.check('a').allowed).toBe(true);
  expect(limiter.check('a')).toEqual({allowed:false,retryAfterSeconds:1});
 });
 it('isolates counters by client key',()=>{
  const limiter=new FixedWindowRateLimiter({limit:1,windowMs:1_000,maxEntries:10,now:()=>100});
  expect(limiter.check('a').allowed).toBe(true);
  expect(limiter.check('a').allowed).toBe(false);
  expect(limiter.check('b').allowed).toBe(true);
 });
 it('allows requests after the window expires',()=>{
  let now=100;const limiter=new FixedWindowRateLimiter({limit:1,windowMs:1_000,maxEntries:10,now:()=>now});
  expect(limiter.check('a').allowed).toBe(true);
  expect(limiter.check('a').allowed).toBe(false);
  now=1_101;
  expect(limiter.check('a').allowed).toBe(true);
 });
 it('keeps memory bounded and evicts the oldest client',()=>{
  const limiter=new FixedWindowRateLimiter({limit:1,windowMs:10_000,maxEntries:2,now:()=>100});
  limiter.check('a');limiter.check('b');limiter.check('c');
  expect(limiter.size).toBe(2);
  expect(limiter.check('a').allowed).toBe(true);
  expect(limiter.size).toBe(2);
 });
});
