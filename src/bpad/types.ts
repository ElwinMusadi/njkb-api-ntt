import {z} from 'zod';

export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};

export const knownBpadFields=[
 'Alamat','BBM','DEALER','GUNA','IsiCylinder','JENIS','J_USAHA','JenisKendaraan','KD_BBM','KD_DUMP',
 'KD_GUNA','KD_JR','KD_LOKASI_ASAL','KD_MERK','KD_MILIK','KD_POS','KD_TIPE','KE','K_GUNA','K_JR',
 'Kecamatan','Kelurahan','KodeKec','KodeKel','Kohir','MILIK','Merk','NM_DEALER','NM_USAHA','NOPOL',
 'NOPOL_EKS','NO_SIUP','NO_USAHA','NamaPemilik','NoBPKB','NoKTP','NoMesin','NoRangka','Rt','RubahBentuk',
 'Rw','SD_NOTICE','SD_STNK','Skum','TG_FAKTUR','TNKB','T_GUNA','TahunPembuatan','TglPKBLalu','TglSTNKLalu',
 'Type','UPT_ASAL','Warna','kode','pesan','status'
] as const;
export type KnownBpadField=typeof knownBpadFields[number];

export interface BpadRawRecord { [key:string]:JsonValue|undefined;
 Alamat?:JsonValue;BBM?:JsonValue;DEALER?:JsonValue;GUNA?:JsonValue;IsiCylinder?:JsonValue;JENIS?:JsonValue;J_USAHA?:JsonValue;
 JenisKendaraan?:JsonValue;KD_BBM?:JsonValue;KD_DUMP?:JsonValue;KD_GUNA?:JsonValue;KD_JR?:JsonValue;KD_LOKASI_ASAL?:JsonValue;
 KD_MERK?:JsonValue;KD_MILIK?:JsonValue;KD_POS?:JsonValue;KD_TIPE?:JsonValue;KE?:JsonValue;K_GUNA?:JsonValue;K_JR?:JsonValue;
 Kecamatan?:JsonValue;Kelurahan?:JsonValue;KodeKec?:JsonValue;KodeKel?:JsonValue;Kohir?:JsonValue;MILIK?:JsonValue;Merk?:JsonValue;
 NM_DEALER?:JsonValue;NM_USAHA?:JsonValue;NOPOL?:JsonValue;NOPOL_EKS?:JsonValue;NO_SIUP?:JsonValue;NO_USAHA?:JsonValue;
 NamaPemilik?:JsonValue;NoBPKB?:JsonValue;NoKTP?:JsonValue;NoMesin?:JsonValue;NoRangka?:JsonValue;Rt?:JsonValue;RubahBentuk?:JsonValue;
 Rw?:JsonValue;SD_NOTICE?:JsonValue;SD_STNK?:JsonValue;Skum?:JsonValue;TG_FAKTUR?:JsonValue;TNKB?:JsonValue;T_GUNA?:JsonValue;
 TahunPembuatan?:JsonValue;TglPKBLalu?:JsonValue;TglSTNKLalu?:JsonValue;Type?:JsonValue;UPT_ASAL?:JsonValue;Warna?:JsonValue;
 kode?:JsonValue;pesan?:JsonValue;status?:JsonValue;
}

const jsonValueSchema:z.ZodType<JsonValue>=z.lazy(()=>z.union([
 z.null(),z.boolean(),z.number(),z.string(),z.array(jsonValueSchema),z.record(z.string(),jsonValueSchema)
]));
const knownShape=Object.fromEntries(knownBpadFields.map(field=>[field,jsonValueSchema.optional()])) as Record<KnownBpadField,z.ZodOptional<typeof jsonValueSchema>>;
export const bpadRawRecordSchema=z.object(knownShape).catchall(jsonValueSchema);

const requiredMatchingString=z.union([z.string(),z.number()]).transform(value=>String(value).trim()).pipe(z.string().min(1));
export const bpadMatchingProjectionSchema=z.object({
 NOPOL:requiredMatchingString,JenisKendaraan:requiredMatchingString,Merk:requiredMatchingString,KD_MERK:requiredMatchingString,
 Type:requiredMatchingString,KD_TIPE:requiredMatchingString,TahunPembuatan:z.coerce.number().int().min(1900).max(2200)
});

export type BpadMatchingProjection=z.infer<typeof bpadMatchingProjectionSchema>;
export interface BpadVehicleRecord {
 raw:Readonly<BpadRawRecord>;
 matching:BpadMatchingProjection;
 meta:{code:string|null;status:string|null;message:string|null};
}

function deepFreeze<T extends JsonValue>(value:T):Readonly<T> {
 if(value!==null&&typeof value==='object') {for(const child of Object.values(value)) deepFreeze(child);Object.freeze(value);}
 return value;
}
export function parseBpadVehicleRecord(input:unknown):BpadVehicleRecord {
 const parsed=bpadRawRecordSchema.parse(input);const raw=deepFreeze(structuredClone(parsed)) as Readonly<BpadRawRecord>;
 const matching=bpadMatchingProjectionSchema.parse(raw);
 return {raw,matching,meta:{code:text(raw.kode),status:text(raw.status),message:text(raw.pesan)}};
}
function text(value:JsonValue|undefined):string|null {return typeof value==='string'?value:null;}
