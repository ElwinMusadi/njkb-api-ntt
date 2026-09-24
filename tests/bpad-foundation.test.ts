import {describe,expect,it} from 'vitest';
import {knownBpadFields,parseBpadVehicleRecord} from '../src/bpad/types';
import {bpadFieldPolicy} from '../src/bpad/field-policy';
import {normalizeBpadRecord} from '../src/bpad/normalize';
import {syntheticFullBpadRecord} from './fixtures/synthetic-bpad-full';

describe('private BPAD raw and normalized foundation',()=>{
 it('accounts for exactly all 56 audited BPAD fields in types and field policy',()=>{
  expect(knownBpadFields).toHaveLength(56);expect(new Set(knownBpadFields).size).toBe(56);
  expect(Object.keys(bpadFieldPolicy).sort()).toEqual([...knownBpadFields].sort());
  for(const policy of Object.values(bpadFieldPolicy)){expect(policy.mayLog).toBe(false);expect(policy.mayAppearInError).toBe(false);}
 });

 it('preserves every known raw field, empty string, numeric-looking string, and future field exactly',()=>{
  const before=structuredClone(syntheticFullBpadRecord);const parsed=parseBpadVehicleRecord(syntheticFullBpadRecord);
  expect(parsed.raw).toEqual(before);expect(parsed.raw.FutureBpadFieldExample).toBe('synthetic-value');
  expect(parsed.raw.TahunPembuatan).toBe('2019');expect(typeof parsed.raw.TahunPembuatan).toBe('string');expect(Object.isFrozen(parsed.raw)).toBe(true);
  expect(parsed.raw.KD_LOKASI_ASAL).toBe('010');expect(parsed.raw.KD_POS).toBe('');
  expect(Object.keys(parsed.raw)).toHaveLength(57);for(const field of knownBpadFields)expect(parsed.raw).toHaveProperty(field);expect(syntheticFullBpadRecord).toEqual(before);
 });

 it('rejects non-JSON-compatible future values without exposing their content',()=>{
  let error:unknown;try{parseBpadVehicleRecord({...syntheticFullBpadRecord,FutureBpadFieldExample:()=>"SYNTHETIC SECRET"});}catch(value){error=value;}
  expect(error).toBeDefined();expect(String(error)).not.toContain('SYNTHETIC SECRET');
 });

 it('projects matching fields without weakening required seven-field validation',()=>{
  const record=parseBpadVehicleRecord(syntheticFullBpadRecord);
  expect(record.matching).toEqual({NOPOL:'ZZ0001ZZ',JenisKendaraan:'MINIBUS',Merk:'HONDA',KD_MERK:'167',Type:'HONDA MOBILIO DD4 1.5 S MT CKD',KD_TIPE:'103167 40649',TahunPembuatan:2019});
  expect(()=>parseBpadVehicleRecord({...syntheticFullBpadRecord,KD_TIPE:''})).toThrow();
  expect(()=>parseBpadVehicleRecord({kode:'0',status:'error',pesan:'synthetic degraded response'})).toThrow();
 });

 it('builds normalized convenience fields while leaving raw values untouched',()=>{
  const parsed=parseBpadVehicleRecord(syntheticFullBpadRecord);const normalized=normalizeBpadRecord(parsed.raw);
  expect(normalized.nopol).toBe('ZZ0001ZZ');expect(normalized.vehicle).toMatchObject({category_raw:'MINIBUS',category:'MOBIL PENUMPANG',category_code:'103',year:2019,engine_capacity_cc:1496});
  expect(normalized.registration).toMatchObject({stnk_valid_until:'2031-12-31',invoice_date:'1900-01-01',usage:'PRIBADI',usage_code:'2'});
  expect(normalized.owner).toMatchObject({name:'TEST OWNER',postal_code:null,business_name:null,business_number:null,business_license_number:null});
  expect(normalized.bpad.raw).toBe(parsed.raw);expect(parsed.raw.TG_FAKTUR).toBe('1900-01-01');expect(parsed.raw.KD_POS).toBe('');
  expect(normalized.owner).not.toHaveProperty('phone');
 });

 it('normalizes invalid optional dates to null without changing raw dates',()=>{
  const raw={...syntheticFullBpadRecord,SD_NOTICE:'2030-02-30',SD_STNK:'',IsiCylinder:'1.5L'};
  const parsed=parseBpadVehicleRecord(raw);const normalized=normalizeBpadRecord(parsed.raw);
  expect(normalized.tax.notice_valid_until).toBeNull();expect(normalized.registration.stnk_valid_until).toBeNull();expect(normalized.vehicle.engine_capacity_cc).toBeNull();
  expect(parsed.raw.SD_NOTICE).toBe('2030-02-30');expect(parsed.raw.SD_STNK).toBe('');expect(parsed.raw.IsiCylinder).toBe('1.5L');
 });
});
