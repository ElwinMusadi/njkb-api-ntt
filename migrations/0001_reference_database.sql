CREATE TABLE regulations (
 id TEXT PRIMARY KEY NOT NULL,
 jurisdiction TEXT NOT NULL,
 kind TEXT NOT NULL,
 number TEXT NOT NULL,
 regulation_year INTEGER NOT NULL CHECK(regulation_year BETWEEN 1900 AND 2200),
 title TEXT NOT NULL,
 effective_from TEXT,
 effective_to TEXT,
 CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
) STRICT;

CREATE TABLE source_documents (
 id TEXT PRIMARY KEY NOT NULL,
 regulation_id TEXT NOT NULL REFERENCES regulations(id),
 original_filename TEXT NOT NULL,
 source_url TEXT,
 acquisition_method TEXT NOT NULL CHECK(acquisition_method IN ('official_download','user_upload')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 page_count INTEGER NOT NULL CHECK(page_count>0),
 UNIQUE(id,regulation_id)
) STRICT;

CREATE TABLE reference_editions (
 id TEXT PRIMARY KEY NOT NULL,
 regulation_id TEXT NOT NULL REFERENCES regulations(id),
 tax_year INTEGER NOT NULL CHECK(tax_year BETWEEN 1900 AND 2200),
 jurisdiction TEXT NOT NULL,
 applicability_status TEXT NOT NULL DEFAULT 'unresolved' CHECK(applicability_status IN ('unresolved','historical','approved')),
 applicability_note TEXT NOT NULL,
 UNIQUE(id,regulation_id,tax_year)
) STRICT;

CREATE TABLE njkb_references (
 id TEXT PRIMARY KEY NOT NULL,
 edition_id TEXT NOT NULL,
 regulation_id TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 tax_year INTEGER NOT NULL,
 vehicle_year INTEGER NOT NULL CHECK(vehicle_year BETWEEN 1900 AND 2200),
 section TEXT NOT NULL,
 source_code TEXT NOT NULL,
 source_code_normalized TEXT NOT NULL,
 brand TEXT NOT NULL,
 brand_normalized TEXT NOT NULL,
 type TEXT NOT NULL,
 type_normalized TEXT NOT NULL,
 vehicle_category TEXT NOT NULL,
 vehicle_category_normalized TEXT NOT NULL,
 njkb_rupiah INTEGER NOT NULL CHECK(njkb_rupiah BETWEEN 0 AND 9007199254740991),
 weight_micros INTEGER CHECK(weight_micros BETWEEN 0 AND 9007199254740991),
 dpp_pkb_rupiah INTEGER CHECK(dpp_pkb_rupiah BETWEEN 0 AND 9007199254740991),
 source_pdf_page INTEGER NOT NULL CHECK(source_pdf_page>0),
 source_row TEXT NOT NULL,
 raw_values TEXT NOT NULL CHECK(json_valid(raw_values)),
 normalization_version TEXT NOT NULL,
 review_status TEXT NOT NULL CHECK(review_status IN ('pending','verified','rejected')),
 review_note TEXT NOT NULL,
 FOREIGN KEY(edition_id,regulation_id,tax_year) REFERENCES reference_editions(id,regulation_id,tax_year),
 FOREIGN KEY(source_document_id,regulation_id) REFERENCES source_documents(id,regulation_id),
 UNIQUE(edition_id,source_document_id,section,source_pdf_page,source_row)
) STRICT;
CREATE INDEX idx_njkb_code ON njkb_references(edition_id,source_code_normalized,vehicle_year);
CREATE INDEX idx_njkb_identity ON njkb_references(edition_id,brand_normalized,type_normalized,vehicle_year,vehicle_category_normalized);
CREATE TRIGGER njkb_page_insert BEFORE INSERT ON njkb_references
WHEN NEW.source_pdf_page > (SELECT page_count FROM source_documents WHERE id=NEW.source_document_id)
BEGIN SELECT RAISE(ABORT,'source page exceeds document page count'); END;
CREATE TRIGGER njkb_page_update BEFORE UPDATE ON njkb_references
WHEN NEW.source_pdf_page > (SELECT page_count FROM source_documents WHERE id=NEW.source_document_id)
BEGIN SELECT RAISE(ABORT,'source page exceeds document page count'); END;

CREATE TABLE vehicle_code_mappings (
 id TEXT PRIMARY KEY NOT NULL,
 provider TEXT NOT NULL,
 api_brand_code TEXT NOT NULL,
 api_type_code TEXT NOT NULL,
 edition_id TEXT NOT NULL REFERENCES reference_editions(id),
 target_source_code TEXT NOT NULL,
 vehicle_year INTEGER NOT NULL CHECK(vehicle_year BETWEEN 1900 AND 2200),
 evidence_document_id TEXT NOT NULL REFERENCES source_documents(id),
 evidence_pdf_page INTEGER NOT NULL CHECK(evidence_pdf_page>0),
 evidence_note TEXT NOT NULL,
 review_status TEXT NOT NULL CHECK(review_status IN ('pending','verified','rejected'))
) STRICT;
CREATE INDEX idx_provider_mapping ON vehicle_code_mappings(provider,edition_id,api_brand_code,api_type_code,vehicle_year);

CREATE TABLE njmkb_references (
 id TEXT PRIMARY KEY NOT NULL,
 edition_id TEXT NOT NULL,
 regulation_id TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 tax_year INTEGER NOT NULL,
 modification_type TEXT NOT NULL,
 modification_type_normalized TEXT NOT NULL,
 base_vehicle_category TEXT NOT NULL,
 base_vehicle_category_normalized TEXT NOT NULL,
 year_label_raw TEXT,
 vehicle_year_min INTEGER,
 vehicle_year_max INTEGER,
 year_basis TEXT NOT NULL CHECK(year_basis IN ('explicit_cell','regulation_scope','unresolved')),
 njmkb_rupiah INTEGER CHECK(njmkb_rupiah BETWEEN 0 AND 9007199254740991),
 cell_status TEXT NOT NULL CHECK(cell_status IN ('value','blank','dash','shaded')),
 source_pdf_page INTEGER NOT NULL CHECK(source_pdf_page>0),
 source_row TEXT NOT NULL,
 source_column TEXT NOT NULL,
 raw_values TEXT NOT NULL CHECK(json_valid(raw_values)),
 review_status TEXT NOT NULL CHECK(review_status IN ('pending','verified','rejected')),
 FOREIGN KEY(edition_id,regulation_id,tax_year) REFERENCES reference_editions(id,regulation_id,tax_year),
 FOREIGN KEY(source_document_id,regulation_id) REFERENCES source_documents(id,regulation_id),
 CHECK((cell_status='value' AND njmkb_rupiah IS NOT NULL) OR (cell_status<>'value' AND njmkb_rupiah IS NULL)),
 CHECK(vehicle_year_min IS NULL OR vehicle_year_max IS NULL OR vehicle_year_min<=vehicle_year_max),
 UNIQUE(edition_id,source_document_id,source_pdf_page,source_row,source_column)
) STRICT;

CREATE TABLE match_audits (
 id TEXT PRIMARY KEY NOT NULL,
 requested_tax_year INTEGER NOT NULL CHECK(requested_tax_year BETWEEN 1900 AND 2200),
 vehicle_year INTEGER NOT NULL CHECK(vehicle_year BETWEEN 1900 AND 2200),
 edition_id TEXT REFERENCES reference_editions(id),
 reference_id TEXT REFERENCES njkb_references(id),
 status TEXT NOT NULL CHECK(status IN ('matched','not_found','ambiguous','conflict','reference_unavailable_for_tax_year')),
 method TEXT NOT NULL,
 minimal_vehicle_snapshot TEXT NOT NULL CHECK(json_valid(minimal_vehicle_snapshot)),
 reasons TEXT NOT NULL CHECK(json_valid(reasons)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(status<>'matched' OR (reference_id IS NOT NULL AND edition_id IS NOT NULL))
) STRICT;
CREATE TRIGGER audit_consistency BEFORE INSERT ON match_audits
WHEN NEW.reference_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM njkb_references r WHERE r.id=NEW.reference_id
 AND r.edition_id=NEW.edition_id AND r.tax_year=NEW.requested_tax_year AND r.vehicle_year=NEW.vehicle_year)
BEGIN SELECT RAISE(ABORT,'audit reference context mismatch'); END;

