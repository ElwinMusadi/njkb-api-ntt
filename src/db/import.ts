import { z } from 'zod';
export const normalize = (s: string): string => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const text = z.string().trim().min(1);
const year = z.number().int().min(1900).max(2200);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const review = z.enum(['pending', 'verified', 'rejected']);
export const datasetSchema = z.object({
 schema_version: z.literal(1),
 regulations: z.array(z.object({id:text,jurisdiction:text,kind:text,number:text,regulation_year:year,title:text,effective_from:z.string().nullable(),effective_to:z.string().nullable()}).strict()),
 source_documents: z.array(z.object({id:text,regulation_id:text,original_filename:text,source_url:z.string().url().nullable(),acquisition_method:z.enum(['official_download','user_upload']),sha256:z.string().regex(/^[a-f0-9]{64}$/),page_count:z.number().int().positive()}).strict()),
 reference_editions: z.array(z.object({id:text,regulation_id:text,tax_year:year,jurisdiction:text,applicability_status:z.enum(['unresolved','historical','approved']),applicability_note:text,
  vehicle_year_min:year.optional(),vehicle_year_max:year.optional()}).strict()),
 njkb_references: z.array(z.object({id:text,edition_id:text,regulation_id:text,source_document_id:text,tax_year:year,vehicle_year:year,section:text,source_code:text,brand:text,type:text,vehicle_category:text,njkb_rupiah:money,weight_micros:money.nullable(),dpp_pkb_rupiah:money.nullable(),source_pdf_page:z.number().int().positive(),source_row:text,raw_values:z.record(z.string(),z.unknown()),review_status:review,review_note:text}).strict())
}).strict();
export type Dataset = z.infer<typeof datasetSchema>;
type Cell = string | number | null;
// Only internal, schema-validated table/column identifiers reach this helper.
function insert(db: D1Database, table: string, row: Record<string,Cell>) {
 const keys=Object.keys(row);
 const same=keys.filter(k=>k!=='id').map(k=>`${table}.${k} IS excluded.${k}`).join(' AND ');
 // Identical retries are safe. Changed content under the same ID fails NOT NULL,
 // rolling back the D1 batch instead of silently overwriting reviewed evidence.
 return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET id=CASE WHEN ${same} THEN ${table}.id ELSE NULL END`).bind(...Object.values(row));
}
export async function importDataset(db:D1Database,input:unknown):Promise<{references:number}> {
 const data=datasetSchema.parse(input);
 // Bounded atomic chunks; a large extractor emits independently retryable bundles.
 const count=data.regulations.length+data.source_documents.length+data.reference_editions.length+data.njkb_references.length;
 if(count>80) throw new Error('Bundle exceeds 80 rows; split into independently retryable bundles');
 if(count===0) return {references:0};
 const statements:D1PreparedStatement[]=[];
 for(const table of ['regulations','source_documents','reference_editions'] as const)
  for(const row of data[table]) statements.push(insert(db,table,row));
 for(const row of data.njkb_references) {
  statements.push(insert(db,'njkb_references',{
   ...row,source_code_normalized:normalize(row.source_code),brand_normalized:normalize(row.brand),
   type_normalized:normalize(row.type),vehicle_category_normalized:normalize(row.vehicle_category),
   raw_values:JSON.stringify(row.raw_values),normalization_version:'nfkc-upper-whitespace-v1'
  }));
 }
 await db.batch(statements);
 return {references:data.njkb_references.length};
}
