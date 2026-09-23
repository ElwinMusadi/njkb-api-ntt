import {describe,expect,it} from 'vitest';
import {normalizeVehicle} from '../src/vehicle/normalize';
import type {BpadVehicle} from '../src/bpad/adapter';

const vehicle=(vehicleCategory:string):BpadVehicle=>({
 nopol:'DH0001AA',vehicleCategory,brand:'TEST',brandCode:'1',type:'TEST TYPE',typeCode:'100001 00001',vehicleYear:2025
});

describe('verified BPAD vehicle category normalization',()=>{
 it.each([
  ['SEPEDA MOTOR','SEPEDA MOTOR RODA DUA'],
  ['SEPEDA MOTOR RODA 2','SEPEDA MOTOR RODA DUA'],
  ['SEPEDA MOTOR RODA DUA','SEPEDA MOTOR RODA DUA'],
  ['SPM R3','SEPEDA MOTOR RODA TIGA'],
  ['SEDAN','MOBIL PENUMPANG'],
  ['JEEP','MOBIL PENUMPANG'],
  ['MINIBUS','MOBIL PENUMPANG'],
  ['PICK UP','MOBIL BARANG'],
  ['BLIND VAN','MOBIL BARANG'],
  ['LIGHT TRUCK','MOBIL BARANG'],
  ['TRUCK','MOBIL BARANG'],
  ['MICROBUS','BUS'],
  ['BUS','BUS'],
  ['MOBIL PENUMPANG SEDAN','MOBIL PENUMPANG'],
  ['MOBIL BARANG PICK UP','MOBIL BARANG'],
  ['MOBIL BUS BESAR','BUS']
 ])('maps %s to %s', (raw,expected)=>{
  expect(normalizeVehicle(vehicle(raw)).vehicleCategory).toBe(expected);
 });

 it.each(['DOUBLE CABIN','','UNKNOWN CATEGORY'])("does not guess unverified category '%s'",raw=>{
  expect(normalizeVehicle(vehicle(raw)).vehicleCategory).toBe(raw.trim().toUpperCase());
 });
});
