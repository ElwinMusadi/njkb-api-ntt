-- Persist the Phase 6 vehicle-year authority boundary in D1 so invalid
-- Phase 7 rows cannot become matchable through ingestion or direct SQL.
ALTER TABLE reference_editions ADD COLUMN vehicle_year_min INTEGER CHECK(vehicle_year_min BETWEEN 1900 AND 2200);
ALTER TABLE reference_editions ADD COLUMN vehicle_year_max INTEGER CHECK(vehicle_year_max BETWEEN 1900 AND 2200);

UPDATE reference_editions
SET vehicle_year_min=1900, vehicle_year_max=2025
WHERE id='edition-2025';

UPDATE reference_editions
SET vehicle_year_min=2026, vehicle_year_max=2026
WHERE id='edition-2026';

CREATE TRIGGER reference_edition_scope_insert
BEFORE INSERT ON reference_editions
WHEN NEW.vehicle_year_min IS NOT NULL AND NEW.vehicle_year_max IS NOT NULL AND NEW.vehicle_year_min>NEW.vehicle_year_max
BEGIN SELECT RAISE(ABORT,'invalid reference edition vehicle-year scope'); END;

CREATE TRIGGER reference_edition_scope_update
BEFORE UPDATE OF vehicle_year_min,vehicle_year_max ON reference_editions
WHEN NEW.vehicle_year_min IS NOT NULL AND NEW.vehicle_year_max IS NOT NULL AND NEW.vehicle_year_min>NEW.vehicle_year_max
BEGIN SELECT RAISE(ABORT,'invalid reference edition vehicle-year scope'); END;

CREATE TRIGGER njkb_vehicle_year_scope_insert
BEFORE INSERT ON njkb_references
WHEN NOT EXISTS (
 SELECT 1 FROM reference_editions e
 WHERE e.id=NEW.edition_id
   AND e.vehicle_year_min IS NOT NULL
   AND e.vehicle_year_max IS NOT NULL
   AND NEW.vehicle_year BETWEEN e.vehicle_year_min AND e.vehicle_year_max
)
BEGIN SELECT RAISE(ABORT,'njkb reference vehicle year outside edition scope'); END;

CREATE TRIGGER njkb_vehicle_year_scope_update
BEFORE UPDATE OF edition_id,vehicle_year ON njkb_references
WHEN NOT EXISTS (
 SELECT 1 FROM reference_editions e
 WHERE e.id=NEW.edition_id
   AND e.vehicle_year_min IS NOT NULL
   AND e.vehicle_year_max IS NOT NULL
   AND NEW.vehicle_year BETWEEN e.vehicle_year_min AND e.vehicle_year_max
)
BEGIN SELECT RAISE(ABORT,'njkb reference vehicle year outside edition scope'); END;

CREATE INDEX idx_reference_edition_vehicle_scope
ON reference_editions(applicability_status,jurisdiction,vehicle_year_min,vehicle_year_max);
