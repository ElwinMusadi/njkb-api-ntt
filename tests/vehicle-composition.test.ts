import {describe,expect,it,vi} from 'vitest';
import {BpadError,type FullVehicleProvider} from '../src/bpad/adapter';
import {expandScopes} from '../src/auth/contracts';
import {parseBpadVehicleRecord,type BpadVehicleRecord} from '../src/bpad/types';
import type {MatchResult} from '../src/matching/engine';
import {shapeUnifiedVehicleResponse} from '../src/private-api/contracts';
import {UnifiedVehicleCompositionService,type VehicleMatcher} from '../src/vehicle/composition';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';

const record=():BpadVehicleRecord=>parseBpadVehicleRecord(structuredClone(syntheticFullBpadRecord));
const provider=(value:BpadVehicleRecord=record()):FullVehicleProvider=>({getVehicleRecord:vi.fn(async()=>value)});
const matcher=(result:MatchResult):VehicleMatcher=>({match:vi.fn(async()=>result)});
const matched:MatchResult={status:'matched',match_method:'exact_code',njkb:150000000,weight_micros:1050000,dpp_pkb:157500000,
 source:{regulation:'Pergub NTT No. 26 Tahun 2025',document_sha256:'synthetic-hash',pdf_page:181,row:'2587',source_code:'103167 40649',reference_id:'synthetic-reference'}};

describe('unified vehicle composition service',()=>{
 it('composes normalized BPAD, raw data, matched NJKB, and provenance exactly once',async()=>{
  const source=record(),vehicles=provider(source),matches=matcher(matched),service=new UnifiedVehicleCompositionService(vehicles,matches);
  const result=await service.lookup('ZZ0001ZZ','2026-09-20');
  expect(result.status).toBe('vehicle_found');if(result.status!=='vehicle_found')throw new Error('unexpected');
  expect(vehicles.getVehicleRecord).toHaveBeenCalledOnce();expect(matches.match).toHaveBeenCalledOnce();
  expect(matches.match).toHaveBeenCalledWith({vehicleCategory:'MOBIL PENUMPANG',brand:'HONDA',brandCode:'167',type:'HONDA MOBILIO DD4 1.5 S MT CKD',typeCode:'103167 40649',vehicleYear:2019},'2026-09-20');
  expect(JSON.stringify(vi.mocked(matches.match).mock.calls)).not.toMatch(/TEST OWNER|TEST ADDRESS|NoKTP|TEST-BPKB|TEST-CHASSIS|FutureBpadFieldExample/);
  expect(result).toMatchObject({vehicleStatus:'found',njkbStatus:'matched',njkb:{value:'150000000.00',weight:'1.050000',dpp_pkb:'157500000.00'},
   match:{method:'exact_code_year_and_brand_type',source_code:'103167 40649'},source:{regulation:'Pergub NTT No. 26 Tahun 2025',pdf_page:181,source_row:'2587'}});
  expect(result.record).toBe(source);expect(result.normalized.bpad.raw).toBe(source.raw);expect(Object.isFrozen(result.record.raw)).toBe(true);
  expect(result.normalized.owner.name).toBe('TEST OWNER');expect(result.normalized.registration.bpkb_number).toBe('TEST-BPKB-0001');
  expect(result.matchResult).toBe(matched);
 });

 it.each([
  ['not_found',{status:'not_found',vehicle_year:2019,review_candidates:[]} as MatchResult],
  ['reference_unavailable',{status:'reference_unavailable',vehicle_year:2019,reason:'synthetic'} as MatchResult],
  ['conflict',{status:'conflict',vehicle_year:2019,method:'exact_code',conflicts:['vehicle_category'],candidate:{reference_id:'synthetic',source_code:'103167 40649',brand:'HONDA',type:'TEST',vehicle_year:2019}} as MatchResult],
  ['ambiguous',{status:'ambiguous',vehicle_year:2019,method:'exact_code',candidates:[{reference_id:'one',source_code:'103167 40649',brand:'HONDA',type:'TEST',vehicle_year:2019},{reference_id:'two',source_code:'103167 40649',brand:'HONDA',type:'TEST',vehicle_year:2019}]} as MatchResult]
 ] as const)('preserves independent NJKB status %s without collapsing the vehicle result',async(status,matchResult)=>{
  const result=await new UnifiedVehicleCompositionService(provider(),matcher(matchResult)).lookup('ZZ0001ZZ','2026-09-20');
  expect(result.status).toBe('vehicle_found');if(result.status!=='vehicle_found')throw new Error('unexpected');
  expect(result.vehicleStatus).toBe('found');expect(result.njkbStatus).toBe(status);expect(result.matchResult).toBe(matchResult);expect(result.normalized.vehicle.brand).toBe('HONDA');
  if(status==='conflict') expect(result).toMatchObject({njkb:null,match:{method:'exact_code_year_and_brand_type',conflicts:['vehicle_category']},source:null});
  else if(status==='ambiguous') expect(result).toMatchObject({njkb:null,match:{method:'exact_code_year_and_brand_type'},source:null});
  else expect(result).toMatchObject({njkb:null,match:null,source:null});
 });

 it('preserves typed BPAD failure, does not create raw data, and never calls matcher',async()=>{
  const failure=new BpadError('network_error','BPAD API tidak dapat dihubungi');const vehicles:FullVehicleProvider={getVehicleRecord:vi.fn(async()=>{throw failure;})};const matches=matcher(matched);
  const result=await new UnifiedVehicleCompositionService(vehicles,matches).lookup('ZZ0001ZZ','2026-09-20');
  expect(result).toEqual({status:'upstream_error',vehicleStatus:'upstream_error',njkbStatus:null,error:failure});expect(matches.match).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty('record');expect(result).not.toHaveProperty('raw');expect(JSON.stringify(result)).not.toMatch(/TEST OWNER|TEST ADDRESS|9999999999999999/);
 });

 it('preserves invalid NOPOL as a typed invalid_request without matcher execution',async()=>{
  const failure=new BpadError('invalid_nopol','Format NOPOL tidak valid');const vehicles:FullVehicleProvider={getVehicleRecord:vi.fn(async()=>{throw failure;})};const matches=matcher(matched);
  const result=await new UnifiedVehicleCompositionService(vehicles,matches).lookup('INVALID','2026-09-20');
  expect(result).toEqual({status:'invalid_request',vehicleStatus:null,njkbStatus:null,error:failure});expect(matches.match).not.toHaveBeenCalled();
 });

 it('feeds composition directly into scope-aware shaping without auth dependency',async()=>{
  const result=await new UnifiedVehicleCompositionService(provider(),matcher(matched)).composeRecord(record(),'2026-09-20');
  const basic=shapeUnifiedVehicleResponse(result,expandScopes(['vehicle:read']));expect(basic.njkb_status).toBe('matched');expect(basic).not.toHaveProperty('owner');expect(basic).not.toHaveProperty('njkb');
  const full=shapeUnifiedVehicleResponse(result,expandScopes(['vehicle:full']));expect(full.owner?.name).toBe('TEST OWNER');expect(full.bpad.raw?.FutureBpadFieldExample).toBe('synthetic-value');expect(full.njkb?.value).toBe('150000000.00');
 });
});
