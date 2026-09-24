import type {KnownBpadField} from './types';
import type {GranularPrivateScope} from '../auth/contracts';

export type TechnicalSensitivity='NON_SENSITIVE_VEHICLE'|'REGISTRATION_ADMINISTRATIVE'|'PERSONAL_DATA'|'HIGHLY_SENSITIVE_IDENTIFIER'|'BPAD_METADATA'|'UNKNOWN_SEMANTICS';
export interface BpadFieldPolicy {
 classification:TechnicalSensitivity;
 normalizedSection:'vehicle'|'registration'|'tax'|'owner'|'administrative'|'bpad';
 normalizedField:string|null;
 requiredScope:GranularPrivateScope;
 mayLog:false;
 mayAppearInError:false;
 syntheticFixtureAllowed:true;
}
const p=(classification:TechnicalSensitivity,normalizedSection:BpadFieldPolicy['normalizedSection'],normalizedField:string|null,requiredScope:GranularPrivateScope):BpadFieldPolicy=>({classification,normalizedSection,normalizedField,requiredScope,mayLog:false,mayAppearInError:false,syntheticFixtureAllowed:true});

export const bpadFieldPolicy:Record<KnownBpadField,BpadFieldPolicy>={
 Alamat:p('PERSONAL_DATA','owner','address','owner:read'),BBM:p('NON_SENSITIVE_VEHICLE','vehicle','fuel','vehicle:read'),
 DEALER:p('REGISTRATION_ADMINISTRATIVE','administrative','dealer_code','registration:read'),GUNA:p('REGISTRATION_ADMINISTRATIVE','registration','usage_category','registration:read'),
 IsiCylinder:p('NON_SENSITIVE_VEHICLE','vehicle','engine_capacity_cc','vehicle:read'),JENIS:p('NON_SENSITIVE_VEHICLE','vehicle','category_code','vehicle:read'),
 J_USAHA:p('PERSONAL_DATA','owner','business_type','owner:read'),JenisKendaraan:p('NON_SENSITIVE_VEHICLE','vehicle','category_raw','vehicle:read'),
 KD_BBM:p('NON_SENSITIVE_VEHICLE','vehicle','fuel_code','vehicle:read'),KD_DUMP:p('UNKNOWN_SEMANTICS','administrative',null,'registration:read'),
 KD_GUNA:p('REGISTRATION_ADMINISTRATIVE','registration','usage_code','registration:read'),KD_JR:p('UNKNOWN_SEMANTICS','administrative',null,'registration:read'),
 KD_LOKASI_ASAL:p('REGISTRATION_ADMINISTRATIVE','administrative','origin_location_code','registration:read'),KD_MERK:p('NON_SENSITIVE_VEHICLE','vehicle','brand_code','vehicle:read'),
 KD_MILIK:p('PERSONAL_DATA','owner','ownership_code','owner:read'),KD_POS:p('PERSONAL_DATA','owner','postal_code','owner:read'),
 KD_TIPE:p('NON_SENSITIVE_VEHICLE','vehicle','type_code','vehicle:read'),KE:p('UNKNOWN_SEMANTICS','administrative',null,'registration:read'),
 K_GUNA:p('REGISTRATION_ADMINISTRATIVE','registration','usage','registration:read'),K_JR:p('UNKNOWN_SEMANTICS','administrative',null,'registration:read'),
 Kecamatan:p('PERSONAL_DATA','owner','district','owner:read'),Kelurahan:p('PERSONAL_DATA','owner','village','owner:read'),
 KodeKec:p('PERSONAL_DATA','owner','district_code','owner:read'),KodeKel:p('PERSONAL_DATA','owner','village_code','owner:read'),
 Kohir:p('HIGHLY_SENSITIVE_IDENTIFIER','tax','kohir','tax:read'),MILIK:p('PERSONAL_DATA','owner','ownership_description','owner:read'),
 Merk:p('NON_SENSITIVE_VEHICLE','vehicle','brand','vehicle:read'),NM_DEALER:p('REGISTRATION_ADMINISTRATIVE','administrative','dealer_name','registration:read'),
 NM_USAHA:p('PERSONAL_DATA','owner','business_name','owner:read'),NOPOL:p('PERSONAL_DATA','vehicle','nopol','vehicle:read'),
 NOPOL_EKS:p('HIGHLY_SENSITIVE_IDENTIFIER','registration','previous_nopol','registration:read'),NO_SIUP:p('HIGHLY_SENSITIVE_IDENTIFIER','owner','business_license_number','owner:read'),
 NO_USAHA:p('HIGHLY_SENSITIVE_IDENTIFIER','owner','business_number','owner:read'),NamaPemilik:p('PERSONAL_DATA','owner','name','owner:read'),
 NoBPKB:p('HIGHLY_SENSITIVE_IDENTIFIER','registration','bpkb_number','registration:read'),NoKTP:p('HIGHLY_SENSITIVE_IDENTIFIER','owner','identity_number','owner:read'),
 NoMesin:p('HIGHLY_SENSITIVE_IDENTIFIER','vehicle','engine_number','registration:read'),NoRangka:p('HIGHLY_SENSITIVE_IDENTIFIER','vehicle','chassis_number','registration:read'),
 Rt:p('PERSONAL_DATA','owner','rt','owner:read'),RubahBentuk:p('REGISTRATION_ADMINISTRATIVE','vehicle','body_modification','vehicle:read'),
 Rw:p('PERSONAL_DATA','owner','rw','owner:read'),SD_NOTICE:p('REGISTRATION_ADMINISTRATIVE','tax','notice_valid_until','tax:read'),
 SD_STNK:p('REGISTRATION_ADMINISTRATIVE','registration','stnk_valid_until','registration:read'),Skum:p('UNKNOWN_SEMANTICS','administrative','skum','registration:read'),
 TG_FAKTUR:p('REGISTRATION_ADMINISTRATIVE','registration','invoice_date','registration:read'),TNKB:p('REGISTRATION_ADMINISTRATIVE','registration','plate_color','registration:read'),
 T_GUNA:p('REGISTRATION_ADMINISTRATIVE','registration','usage_type_code','registration:read'),TahunPembuatan:p('NON_SENSITIVE_VEHICLE','vehicle','year','vehicle:read'),
 TglPKBLalu:p('REGISTRATION_ADMINISTRATIVE','tax','previous_pkb_date','tax:read'),TglSTNKLalu:p('REGISTRATION_ADMINISTRATIVE','registration','previous_stnk_date','registration:read'),
 Type:p('NON_SENSITIVE_VEHICLE','vehicle','type','vehicle:read'),UPT_ASAL:p('REGISTRATION_ADMINISTRATIVE','administrative','origin_upt','registration:read'),
 Warna:p('NON_SENSITIVE_VEHICLE','vehicle','color','vehicle:read'),kode:p('BPAD_METADATA','bpad','code','vehicle:read'),
 pesan:p('BPAD_METADATA','bpad','message','vehicle:read'),status:p('BPAD_METADATA','bpad','status','vehicle:read')
};
