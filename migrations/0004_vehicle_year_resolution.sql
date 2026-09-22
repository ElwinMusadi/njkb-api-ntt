DROP TRIGGER IF EXISTS audit_consistency;
DROP TRIGGER IF EXISTS audit_consistency_update;

ALTER TABLE match_audits RENAME TO match_audits_phase3;

CREATE TABLE match_audits (
 id TEXT PRIMARY KEY NOT NULL,
 resolution_as_of TEXT NOT NULL CHECK(resolution_as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 vehicle_year INTEGER NOT NULL CHECK(vehicle_year BETWEEN 1900 AND 2200),
 edition_id TEXT REFERENCES reference_editions(id),
 reference_id TEXT REFERENCES njkb_references(id),
 status TEXT NOT NULL CHECK(status IN ('matched','not_found','ambiguous','conflict','reference_unavailable')),
 method TEXT NOT NULL,
 minimal_vehicle_snapshot TEXT NOT NULL CHECK(json_valid(minimal_vehicle_snapshot)),
 reasons TEXT NOT NULL CHECK(json_valid(reasons)),
 legacy_requested_tax_year INTEGER CHECK(legacy_requested_tax_year BETWEEN 1900 AND 2200),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(status<>'matched' OR (reference_id IS NOT NULL AND edition_id IS NOT NULL))
) STRICT;

INSERT INTO match_audits
 (id,resolution_as_of,vehicle_year,edition_id,reference_id,status,method,minimal_vehicle_snapshot,reasons,legacy_requested_tax_year,created_at)
SELECT id,substr(created_at,1,10),vehicle_year,edition_id,reference_id,
 CASE status WHEN 'reference_unavailable_for_tax_year' THEN 'reference_unavailable' ELSE status END,
 method,minimal_vehicle_snapshot,reasons,requested_tax_year,created_at
FROM match_audits_phase3;

DROP TABLE match_audits_phase3;

CREATE TRIGGER audit_consistency BEFORE INSERT ON match_audits
WHEN NEW.reference_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM njkb_references r WHERE r.id=NEW.reference_id AND r.edition_id=NEW.edition_id AND r.vehicle_year=NEW.vehicle_year)
BEGIN SELECT RAISE(ABORT,'audit reference context mismatch'); END;

CREATE TRIGGER audit_consistency_update BEFORE UPDATE ON match_audits
WHEN NEW.reference_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM njkb_references r WHERE r.id=NEW.reference_id AND r.edition_id=NEW.edition_id AND r.vehicle_year=NEW.vehicle_year)
BEGIN SELECT RAISE(ABORT,'audit reference context mismatch'); END;

CREATE INDEX idx_reference_edition_resolution ON reference_editions(applicability_status,jurisdiction);
CREATE INDEX idx_njkb_coverage ON njkb_references(edition_id,vehicle_year,vehicle_category_normalized,review_status);

-- Pergub NTT 26/2025 is the approved provincial reference for vehicle years
-- up to and including 2025 (Pasal 7, Appendix A, verified row evidence).
-- Phase 6 regulatory decision: vehicle_year <= 2025 resolves from this edition.
-- Resolution remains constrained to exact vehicle year and identity; no cross-year
-- substitution, interpolation, or automatic code alias is permitted.
UPDATE reference_editions
SET applicability_status='approved',
    applicability_note='Approved provincial reference under Pergub NTT No. 26 Tahun 2025 for vehicle years up to 2025 (Pasal 7, Appendix A). Resolution constrained to exact vehicle year and identity. Phase 6 regulatory decision: vehicle_year <= 2025 resolves from this edition; no cross-year fallback.'
WHERE regulation_id IN (
 SELECT id FROM regulations
 WHERE kind='Pergub' AND number='26' AND regulation_year=2025
) AND applicability_status IN ('unresolved','historical');

-- Permendagri 11/2026 Appendix A is an approved national reference for
-- vehicle year 2026 (Article 18). This is regulatory metadata, not a code
-- crosswalk and not permission to substitute values across vehicle years.
UPDATE reference_editions
SET applicability_status='approved',
    applicability_note='Authoritative national 2026 reference under Permendagri 11/2026 Pasal 18; automatic resolution remains constrained to exact vehicle year and identity.'
WHERE regulation_id IN (
 SELECT id FROM regulations
 WHERE kind='Permendagri' AND number='11' AND regulation_year=2026
) AND applicability_status='unresolved';

UPDATE source_documents
SET source_url='https://jdih.kemendagri.go.id/dokumen/view?id=2060'
WHERE regulation_id IN (
 SELECT id FROM regulations
 WHERE kind='Permendagri' AND number='11' AND regulation_year=2026
) AND source_url IS NULL;
