ALTER TABLE njkb_references ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'legacy_fixture';
CREATE UNIQUE INDEX idx_source_document_identity ON source_documents(regulation_id,sha256);

CREATE TABLE ingestion_manifests (
 id TEXT PRIMARY KEY NOT NULL,
 dataset_id TEXT NOT NULL,
 schema_version INTEGER NOT NULL CHECK(schema_version=2),
 source_format TEXT NOT NULL CHECK(source_format IN ('json','csv')),
 dataset_sha256 TEXT NOT NULL CHECK(length(dataset_sha256)=64 AND dataset_sha256 NOT GLOB '*[^0-9a-f]*'),
 document_sha256 TEXT NOT NULL CHECK(length(document_sha256)=64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'),
 regulation_id TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 edition_id TEXT NOT NULL,
 tax_year INTEGER NOT NULL CHECK(tax_year BETWEEN 1900 AND 2200),
 extraction_method TEXT NOT NULL,
 extraction_tool TEXT,
 extraction_tool_version TEXT,
 source_created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('importing','completed')),
 record_count INTEGER NOT NULL CHECK(record_count>=0),
 inserted_count INTEGER NOT NULL DEFAULT 0 CHECK(inserted_count>=0),
 unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_count>=0),
 warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count>=0),
 summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
 imported_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(regulation_id) REFERENCES regulations(id),
 FOREIGN KEY(source_document_id,regulation_id) REFERENCES source_documents(id,regulation_id),
 FOREIGN KEY(edition_id,regulation_id,tax_year) REFERENCES reference_editions(id,regulation_id,tax_year),
 UNIQUE(source_document_id,dataset_sha256)
) STRICT;
CREATE INDEX idx_ingestion_document ON ingestion_manifests(source_document_id,dataset_sha256,status);

CREATE TABLE ingestion_records (
 manifest_id TEXT NOT NULL REFERENCES ingestion_manifests(id),
 record_index INTEGER NOT NULL CHECK(record_index>=0),
 reference_id TEXT NOT NULL REFERENCES njkb_references(id),
 source_pdf_page INTEGER NOT NULL CHECK(source_pdf_page>0),
 source_row TEXT NOT NULL,
 record_fingerprint TEXT NOT NULL CHECK(length(record_fingerprint)=64 AND record_fingerprint NOT GLOB '*[^0-9a-f]*'),
 raw_values TEXT NOT NULL CHECK(json_valid(raw_values)),
 normalized_values TEXT NOT NULL CHECK(json_valid(normalized_values)),
 extraction_method TEXT NOT NULL,
 review_status TEXT NOT NULL CHECK(review_status IN ('pending','verified','rejected')),
 review_note TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('inserted','unchanged')),
 PRIMARY KEY(manifest_id,record_index)
) STRICT;
CREATE INDEX idx_ingestion_reference ON ingestion_records(reference_id);

CREATE TABLE ingestion_issues (
 id TEXT PRIMARY KEY NOT NULL,
 manifest_id TEXT NOT NULL REFERENCES ingestion_manifests(id),
 record_index INTEGER,
 source_pdf_page INTEGER,
 source_row TEXT,
 severity TEXT NOT NULL CHECK(severity IN ('warning','error')),
 code TEXT NOT NULL,
 field TEXT,
 message TEXT NOT NULL,
 details TEXT NOT NULL CHECK(json_valid(details)),
 UNIQUE(manifest_id,record_index,code,field)
) STRICT;
CREATE INDEX idx_ingestion_issues_manifest ON ingestion_issues(manifest_id,severity,record_index);
