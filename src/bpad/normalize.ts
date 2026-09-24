import {bpadMatchingProjectionSchema,type BpadMatchingProjection,type BpadRawRecord,type BpadVehicleRecord,type JsonValue} from './types';
import {normalizeVehicle,type NormalizedVehicle} from '../vehicle/normalize';

export interface PrivateVehicle {
 category:string;category_raw:string;category_code:string|null;brand:string;brand_code:string;type:string;type_code:string;
 year:number;color:string|null;plate_color?:string|null;fuel:string|null;fuel_code:string|null;engine_capacity_cc:number|null;
 chassis_number?:string|null;engine_number?:string|null;body_modification:string|null;
}
export interface PrivateRegistration {bpkb_number:string|null;previous_nopol:string|null;stnk_valid_until:string|null;previous_stnk_date:string|null;invoice_date:string|null;plate_color:string|null;usage:string|null;usage_code:string|null;}
export interface PrivateTax {notice_valid_until:string|null;previous_pkb_date:string|null;kohir:string|null;}
export interface PrivateOwner {name:string|null;identity_number:string|null;address:string|null;rt:string|null;rw:string|null;village:string|null;district:string|null;village_code:string|null;district_code:string|null;postal_code:string|null;ownership_code:string|null;ownership_description:string|null;business_type:string|null;business_name:string|null;business_number:string|null;business_license_number:string|null;}
export interface PrivateAdministrative {origin_upt:string|null;origin_location_code:string|null;dealer_code:string|null;dealer_name:string|null;skum:string|null;codes:{kd_dump:string|null;kd_jr:string|null;ke:string|null};labels:{k_jr:string|null};}
export interface PrivateBpadMetadata {code:string|null;status:string|null;message:string|null;raw?:Readonly<BpadRawRecord>;}
export interface NormalizedBpadRecord {nopol:string;matching:NormalizedVehicle;vehicle:PrivateVehicle;registration:PrivateRegistration;tax:PrivateTax;owner:PrivateOwner;administrative:PrivateAdministrative;bpad:PrivateBpadMetadata;}

const optional=(value:JsonValue|undefined):string|null=>(typeof value==='string'||typeof value==='number')&&String(value)!==''?String(value).trim():null;
const required=(value:JsonValue|undefined,field:string):string=>{const result=optional(value);if(result===null)throw new Error(`Missing required BPAD field: ${field}`);return result;};
const date=(value:JsonValue|undefined):string|null=>{const result=optional(value);if(result===null||!/^\d{4}-\d{2}-\d{2}$/.test(result))return null;const parsed=new Date(`${result}T00:00:00Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===result?result:null;};
const integer=(value:JsonValue|undefined):number|null=>{const result=optional(value);return result!==null&&/^\d+$/.test(result)?Number(result):null;};

function isRecord(input:Readonly<BpadRawRecord>|BpadVehicleRecord):input is BpadVehicleRecord {return 'raw' in input&&'matching' in input&&'meta' in input;}
export function normalizeBpadRecord(input:Readonly<BpadRawRecord>|BpadVehicleRecord):NormalizedBpadRecord {
 const raw=isRecord(input)?input.raw:input;const projection:BpadMatchingProjection=isRecord(input)?input.matching:bpadMatchingProjectionSchema.parse(raw);
 const nopol=projection.NOPOL.normalize('NFKC').toUpperCase().replace(/[\s-]+/g,'');
 const matching=normalizeVehicle({nopol,vehicleCategory:projection.JenisKendaraan,brand:projection.Merk,brandCode:projection.KD_MERK,type:projection.Type,typeCode:projection.KD_TIPE,vehicleYear:projection.TahunPembuatan});
 return {nopol,matching,vehicle:{category:matching.vehicleCategory,category_raw:required(raw.JenisKendaraan,'JenisKendaraan'),category_code:optional(raw.JENIS),brand:matching.brand,brand_code:matching.brandCode,type:matching.type,type_code:matching.typeCode,year:matching.vehicleYear,color:optional(raw.Warna),plate_color:optional(raw.TNKB),fuel:optional(raw.BBM),fuel_code:optional(raw.KD_BBM),engine_capacity_cc:integer(raw.IsiCylinder),chassis_number:optional(raw.NoRangka),engine_number:optional(raw.NoMesin),body_modification:optional(raw.RubahBentuk)},
  registration:{bpkb_number:optional(raw.NoBPKB),previous_nopol:optional(raw.NOPOL_EKS),stnk_valid_until:date(raw.SD_STNK),previous_stnk_date:date(raw.TglSTNKLalu),invoice_date:date(raw.TG_FAKTUR),plate_color:optional(raw.TNKB),usage:optional(raw.K_GUNA),usage_code:optional(raw.KD_GUNA)},
  tax:{notice_valid_until:date(raw.SD_NOTICE),previous_pkb_date:date(raw.TglPKBLalu),kohir:optional(raw.Kohir)},
  owner:{name:optional(raw.NamaPemilik),identity_number:optional(raw.NoKTP),address:optional(raw.Alamat),rt:optional(raw.Rt),rw:optional(raw.Rw),village:optional(raw.Kelurahan),district:optional(raw.Kecamatan),village_code:optional(raw.KodeKel),district_code:optional(raw.KodeKec),postal_code:optional(raw.KD_POS),ownership_code:optional(raw.KD_MILIK),ownership_description:optional(raw.MILIK),business_type:optional(raw.J_USAHA),business_name:optional(raw.NM_USAHA),business_number:optional(raw.NO_USAHA),business_license_number:optional(raw.NO_SIUP)},
  administrative:{origin_upt:optional(raw.UPT_ASAL),origin_location_code:optional(raw.KD_LOKASI_ASAL),dealer_code:optional(raw.DEALER),dealer_name:optional(raw.NM_DEALER),skum:optional(raw.Skum),codes:{kd_dump:optional(raw.KD_DUMP),kd_jr:optional(raw.KD_JR),ke:optional(raw.KE)},labels:{k_jr:optional(raw.K_JR)}},
  bpad:{code:optional(raw.kode),status:optional(raw.status),message:optional(raw.pesan),raw}};
}
