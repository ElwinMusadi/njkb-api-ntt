import { z } from 'zod';

const text=z.string().trim().min(1);
const year=z.number().int().min(1900).max(2200);
export const extractionMethodSchema=z.enum(['manual_transcription','pdf_text','ocr','table_extractor','mixed']);
export const regulationSchema=z.object({
 id:text,jurisdiction:text,kind:text,number:text,regulation_year:year,title:text,
 effective_from:z.string().nullable(),effective_to:z.string().nullable()
}).strict();
export const sourceDocumentSchema=z.object({
 id:text,regulation_id:text,original_filename:text,source_url:z.string().url().nullable(),
 acquisition_method:z.enum(['official_download','user_upload']),
 sha256:z.string().regex(/^[a-f0-9]{64}$/),page_count:z.number().int().positive()
}).strict();
export const editionSchema=z.object({
 id:text,regulation_id:text,tax_year:year,jurisdiction:text,
 applicability_status:z.enum(['unresolved','historical','approved']),applicability_note:text,
 vehicle_year_min:year,vehicle_year_max:year
}).strict().refine(value=>value.vehicle_year_min<=value.vehicle_year_max,{message:'vehicle_year_min must not exceed vehicle_year_max'});
export const manifestSchema=z.object({
 dataset_id:text,
 created_at:text.refine(value=>!Number.isNaN(Date.parse(value)),{message:'created_at must be an ISO date-time'}),
 regulation:regulationSchema,
 source_document:sourceDocumentSchema,
 edition:editionSchema,
 extraction:z.object({method:extractionMethodSchema,tool:text.nullable(),tool_version:text.nullable()}).strict(),
 defaults:z.object({section:text,vehicle_category:text}).strict()
}).strict();
export const canonicalEnvelopeSchema=z.object({
 schema_version:z.literal(2),manifest:manifestSchema,records:z.array(z.unknown())
}).strict();

export type CanonicalManifest=z.infer<typeof manifestSchema>;
export type SourceFormat='json'|'csv';
export type IssueSeverity='error'|'warning';
export interface ValidationIssue {
 severity:IssueSeverity;
 code:string;
 message:string;
 record_index:number|null;
 field:string|null;
 source_pdf_page:number|null;
 source_row:string|null;
 details:Record<string,unknown>;
}
export interface NormalizedValues {
 source_code:string;
 brand:string;
 type:string;
 vehicle_year:number;
 vehicle_category:string;
 njkb_rupiah:number;
 weight_micros:number;
 dpp_pkb_rupiah:number;
}
export interface ValidatedRecord {
 recordIndex:number;
 id:string;
 fingerprint:string;
 section:string;
 vehicleCategory:string;
 sourcePdfPage:number;
 sourceRow:string;
 rawValues:Record<string,unknown>;
 normalized:NormalizedValues;
 reviewStatus:'pending'|'verified'|'rejected';
 reviewNote:string;
 extractionMethod:z.infer<typeof extractionMethodSchema>;
}
export interface RejectedRecord {
 record_index:number;
 raw_record:unknown;
 normalized_values:Record<string,unknown>;
 issue_codes:string[];
}
export interface ValidationSummary {
 total_records:number;
 valid_records:number;
 rejected_records:number;
 errors:number;
 warnings:number;
 duplicates:number;
}
export interface ValidationResult {
 sourceFormat:SourceFormat;
 datasetSha256:string;
 manifestId:string|null;
 manifest:CanonicalManifest|null;
 records:ValidatedRecord[];
 issues:ValidationIssue[];
 rejectedRecords:RejectedRecord[];
 summary:ValidationSummary;
 canImport:boolean;
}
export interface ImportSummary extends ValidationSummary {
 inserted_records:number;
 unchanged_records:number;
 persisted_issues:number;
}
export interface ImportReport {
 status:'rejected'|'imported'|'already_imported';
 manifest_id:string|null;
 dataset_id:string|null;
 dataset_sha256:string;
 document_sha256:string|null;
 source_format:SourceFormat;
 summary:ImportSummary;
 issues:ValidationIssue[];
 rejected_records:RejectedRecord[];
}
