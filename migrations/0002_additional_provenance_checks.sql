CREATE TRIGGER audit_consistency_update BEFORE UPDATE ON match_audits
WHEN NEW.reference_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM njkb_references r WHERE r.id=NEW.reference_id
 AND r.edition_id=NEW.edition_id AND r.tax_year=NEW.requested_tax_year AND r.vehicle_year=NEW.vehicle_year)
BEGIN SELECT RAISE(ABORT,'audit reference context mismatch'); END;
CREATE TRIGGER njmkb_page_insert BEFORE INSERT ON njmkb_references
WHEN NEW.source_pdf_page > (SELECT page_count FROM source_documents WHERE id=NEW.source_document_id)
BEGIN SELECT RAISE(ABORT,'source page exceeds document page count'); END;
CREATE TRIGGER njmkb_page_update BEFORE UPDATE ON njmkb_references
WHEN NEW.source_pdf_page > (SELECT page_count FROM source_documents WHERE id=NEW.source_document_id)
BEGIN SELECT RAISE(ABORT,'source page exceeds document page count'); END;
