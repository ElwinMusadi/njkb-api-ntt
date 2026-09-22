import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { hashObject } from '../src/ingestion/hash';
import { loadCanonicalDataset } from '../src/ingestion/load';
import { validateCanonicalDataset } from '../src/ingestion/validation';
import type { ValidatedRecord, ValidationIssue } from '../src/ingestion/types';

export const EXPECTED_PERGUB_SHA256 = 'c9218eb8df0e0a01e1f73dc528f99618daa8c8d069107726bf39c58f891b2a7c';
export const EXPECTED_PERMENDAGRI_SHA256 = 'fcc332ff3e5758791d55f1b08864fd25f0b939ce36ef1f288c8c9b937e33f17e';

export const PERGUB_PATH = 'fixtures/canonical/pergub-ntt-26-2025.full.json';
export const PERMENDAGRI_PATH = 'fixtures/canonical/permendagri-11-2026.full.json';

function sqlString(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlNumber(val: number | bigint | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  return String(val);
}

function sha256Bytes(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface ChunkInfo {
  filename: string;
  type: 'metadata' | 'data' | 'post_ingestion';
  dataset_id: string | null;
  record_count: number;
  statement_count: number;
  bytes: number;
  sha256: string;
}

export interface ProductionExportManifest {
  schema_version: 1;
  created_at: string;
  target_database: string;
  datasets: {
    pergub: {
      path: string;
      expected_records: 62091;
      actual_records: number;
      sha256: string;
    };
    permendagri: {
      path: string;
      expected_records: 2783;
      actual_records: number;
      sha256: string;
    };
  };
  total_records: number;
  total_chunks: number;
  total_sql_bytes: number;
  execution_order: string[];
  chunks: ChunkInfo[];
}

export async function exportProductionSql(options: {
  outputDir?: string;
  chunkSize?: number;
} = {}): Promise<ProductionExportManifest> {
  const outputDir = resolve(options.outputDir ?? 'artifacts/production');
  // 350 records produces ~650-730 KB SQL files, safely bounded under Cloudflare API's 1MB payload limit
  const chunkSize = options.chunkSize ?? 350;

  // 1. Verify file hashes strictly before processing
  const pergubRaw = await readFile(PERGUB_PATH);
  const pergubSha = sha256Bytes(pergubRaw);
  if (pergubSha !== EXPECTED_PERGUB_SHA256) {
    throw new Error(`Pergub SHA-256 mismatch: expected ${EXPECTED_PERGUB_SHA256}, got ${pergubSha}`);
  }

  const permRaw = await readFile(PERMENDAGRI_PATH);
  const permSha = sha256Bytes(permRaw);
  if (permSha !== EXPECTED_PERMENDAGRI_SHA256) {
    throw new Error(`Permendagri SHA-256 mismatch: expected ${EXPECTED_PERMENDAGRI_SHA256}, got ${permSha}`);
  }

  // 2. Load and validate canonical datasets
  const pergubLoaded = await loadCanonicalDataset(PERGUB_PATH);
  const pergubValidated = await validateCanonicalDataset(pergubLoaded.input, pergubLoaded.sourceFormat);
  if (!pergubValidated.canImport || !pergubValidated.manifest || !pergubValidated.manifestId) {
    throw new Error('Pergub canonical dataset failed validation');
  }
  if (pergubValidated.records.length !== 62091) {
    throw new Error(`Pergub record count unexpected: ${pergubValidated.records.length} !== 62091`);
  }

  const permLoaded = await loadCanonicalDataset(PERMENDAGRI_PATH);
  const permValidated = await validateCanonicalDataset(permLoaded.input, permLoaded.sourceFormat);
  if (!permValidated.canImport || !permValidated.manifest || !permValidated.manifestId) {
    throw new Error('Permendagri canonical dataset failed validation');
  }
  if (permValidated.records.length !== 2783) {
    throw new Error(`Permendagri record count unexpected: ${permValidated.records.length} !== 2783`);
  }

  await mkdir(outputDir, { recursive: true });

  const chunks: ChunkInfo[] = [];
  const executionOrder: string[] = [];

  async function writeChunk(
    filename: string,
    type: ChunkInfo['type'],
    datasetId: string | null,
    recordCount: number,
    statementCount: number,
    sql: string
  ): Promise<void> {
    const filePath = join(outputDir, filename);
    const bytes = Buffer.from(sql, 'utf8');
    await writeFile(filePath, bytes);
    const chunkInfo: ChunkInfo = {
      filename,
      type,
      dataset_id: datasetId,
      record_count: recordCount,
      statement_count: statementCount,
      bytes: bytes.length,
      sha256: sha256Bytes(bytes)
    };
    chunks.push(chunkInfo);
    executionOrder.push(filename);
  }

  // 3. Chunk 00: Metadata Initialization
  const metadataLines: string[] = [
    '-- Production D1 Data Deployment - Chunk 00 (Metadata)',
    '-- Schema Version: 2',
    '-- Target: regulations, source_documents, reference_editions, ingestion_manifests',
    'BEGIN TRANSACTION;'
  ];

  let metadataStatements = 0;

  for (const v of [pergubValidated, permValidated]) {
    const m = v.manifest!;
    const reg = m.regulation;
    metadataLines.push(
      `INSERT INTO regulations (id, jurisdiction, kind, number, regulation_year, title, effective_from, effective_to) VALUES (${sqlString(reg.id)}, ${sqlString(reg.jurisdiction)}, ${sqlString(reg.kind)}, ${sqlString(reg.number)}, ${sqlNumber(reg.regulation_year)}, ${sqlString(reg.title)}, ${sqlString(reg.effective_from)}, ${sqlString(reg.effective_to)}) ON CONFLICT(id) DO NOTHING;`
    );
    metadataStatements++;

    const doc = m.source_document;
    metadataLines.push(
      `INSERT INTO source_documents (id, regulation_id, original_filename, source_url, acquisition_method, sha256, page_count) VALUES (${sqlString(doc.id)}, ${sqlString(doc.regulation_id)}, ${sqlString(doc.original_filename)}, ${sqlString(doc.source_url)}, ${sqlString(doc.acquisition_method)}, ${sqlString(doc.sha256)}, ${sqlNumber(doc.page_count)}) ON CONFLICT(id) DO NOTHING;`
    );
    metadataStatements++;

    const ed = m.edition;
    metadataLines.push(
      `INSERT INTO reference_editions (id, regulation_id, tax_year, jurisdiction, applicability_status, applicability_note, vehicle_year_min, vehicle_year_max) VALUES (${sqlString(ed.id)}, ${sqlString(ed.regulation_id)}, ${sqlNumber(ed.tax_year)}, ${sqlString(ed.jurisdiction)}, ${sqlString(ed.applicability_status)}, ${sqlString(ed.applicability_note)}, ${sqlNumber(ed.vehicle_year_min)}, ${sqlNumber(ed.vehicle_year_max)}) ON CONFLICT(id) DO NOTHING;`
    );
    metadataStatements++;

    metadataLines.push(
      `INSERT INTO ingestion_manifests (id, dataset_id, schema_version, source_format, dataset_sha256, document_sha256, regulation_id, source_document_id, edition_id, tax_year, extraction_method, extraction_tool, extraction_tool_version, source_created_at, status, record_count, summary_json) VALUES (${sqlString(v.manifestId)}, ${sqlString(m.dataset_id)}, 2, 'json', ${sqlString(v.datasetSha256)}, ${sqlString(doc.sha256)}, ${sqlString(reg.id)}, ${sqlString(doc.id)}, ${sqlString(ed.id)}, ${sqlNumber(ed.tax_year)}, ${sqlString(m.extraction.method)}, ${sqlString(m.extraction.tool)}, ${sqlString(m.extraction.tool_version)}, ${sqlString(m.created_at)}, 'importing', ${sqlNumber(v.summary.total_records)}, '{}') ON CONFLICT(id) DO NOTHING;`
    );
    metadataStatements++;
  }

  metadataLines.push('COMMIT;');
  await writeChunk('00_metadata.sql', 'metadata', null, 0, metadataStatements, metadataLines.join('\n') + '\n');

  // 4. Data Chunks Helper
  async function generateDataChunks(
    prefix: string,
    datasetId: string,
    manifestId: string,
    manifest: typeof pergubValidated.manifest,
    records: ValidatedRecord[]
  ): Promise<void> {
    const totalChunks = Math.ceil(records.length / chunkSize);
    for (let c = 0; c < totalChunks; c++) {
      const start = c * chunkSize;
      const end = Math.min(start + chunkSize, records.length);
      const chunkRecords = records.slice(start, end);
      const chunkNum = String(c + 1).padStart(2, '0');
      const filename = `${prefix}_chunk_${chunkNum}.sql`;

      const lines: string[] = [
        `-- Production D1 Data Deployment - ${prefix.toUpperCase()} Chunk ${chunkNum}/${String(totalChunks).padStart(2, '0')}`,
        `-- Dataset: ${datasetId}`,
        `-- Records: ${chunkRecords.length} (Index ${start} to ${end - 1})`,
        'BEGIN TRANSACTION;'
      ];

      let stmtCount = 0;

      for (const record of chunkRecords) {
        const val = record.normalized;
        // 1. njkb_references
        lines.push(
          `INSERT INTO njkb_references (id, edition_id, regulation_id, source_document_id, tax_year, vehicle_year, section, source_code, source_code_normalized, brand, brand_normalized, type, type_normalized, vehicle_category, vehicle_category_normalized, njkb_rupiah, weight_micros, dpp_pkb_rupiah, source_pdf_page, source_row, raw_values, normalization_version, review_status, review_note, extraction_method) VALUES (${sqlString(record.id)}, ${sqlString(manifest!.edition.id)}, ${sqlString(manifest!.regulation.id)}, ${sqlString(manifest!.source_document.id)}, ${sqlNumber(manifest!.edition.tax_year)}, ${sqlNumber(val.vehicle_year)}, ${sqlString(record.section)}, ${sqlString(String(record.rawValues.KODING).trim())}, ${sqlString(val.source_code)}, ${sqlString(String(record.rawValues.MERK).trim())}, ${sqlString(val.brand)}, ${sqlString(String(record.rawValues.TYPE).trim())}, ${sqlString(val.type)}, ${sqlString(record.vehicleCategory)}, ${sqlString(val.vehicle_category)}, ${sqlNumber(val.njkb_rupiah)}, ${sqlNumber(val.weight_micros)}, ${sqlNumber(val.dpp_pkb_rupiah)}, ${sqlNumber(record.sourcePdfPage)}, ${sqlString(record.sourceRow)}, ${sqlString(JSON.stringify(record.rawValues))}, 'nfkc-upper-whitespace-v1', ${sqlString(record.reviewStatus)}, ${sqlString(record.reviewNote)}, ${sqlString(record.extractionMethod)}) ON CONFLICT(id) DO NOTHING;`
        );
        stmtCount++;

        // 2. ingestion_records
        lines.push(
          `INSERT INTO ingestion_records (manifest_id, record_index, reference_id, source_pdf_page, source_row, record_fingerprint, raw_values, normalized_values, extraction_method, review_status, review_note, disposition) VALUES (${sqlString(manifestId)}, ${sqlNumber(record.recordIndex)}, ${sqlString(record.id)}, ${sqlNumber(record.sourcePdfPage)}, ${sqlString(record.sourceRow)}, ${sqlString(record.fingerprint)}, ${sqlString(JSON.stringify(record.rawValues))}, ${sqlString(JSON.stringify(record.normalized))}, ${sqlString(record.extractionMethod)}, ${sqlString(record.reviewStatus)}, ${sqlString(record.reviewNote)}, 'inserted') ON CONFLICT(manifest_id, record_index) DO NOTHING;`
        );
        stmtCount++;
      }

      lines.push('COMMIT;');
      await writeChunk(filename, 'data', datasetId, chunkRecords.length, stmtCount, lines.join('\n') + '\n');
    }
  }

  // 5. Generate Pergub Data Chunks
  await generateDataChunks(
    'pergub',
    pergubValidated.manifest!.dataset_id,
    pergubValidated.manifestId!,
    pergubValidated.manifest,
    pergubValidated.records
  );

  // 6. Generate Permendagri Data Chunks
  await generateDataChunks(
    'permendagri',
    permValidated.manifest!.dataset_id,
    permValidated.manifestId!,
    permValidated.manifest,
    permValidated.records
  );

  // 7. Chunk 99: Post-Ingestion (Issues and Manifest Finalization)
  const postLines: string[] = [
    '-- Production D1 Data Deployment - Chunk 99 (Post-Ingestion Finalization)',
    '-- Target: ingestion_issues, ingestion_manifests (status -> completed)',
    'BEGIN TRANSACTION;'
  ];

  let postStatements = 0;

  // Pergub issues (warnings)
  const pergubWarnings = pergubValidated.issues.filter((issue: ValidationIssue) => issue.severity === 'warning');
  for (const issue of pergubWarnings) {
    const issueId = `issue:${await hashObject({ manifest: pergubValidated.manifestId, issue })}`;
    postLines.push(
      `INSERT INTO ingestion_issues (id, manifest_id, record_index, source_pdf_page, source_row, severity, code, field, message, details) VALUES (${sqlString(issueId)}, ${sqlString(pergubValidated.manifestId)}, ${sqlNumber(issue.record_index)}, ${sqlNumber(issue.source_pdf_page)}, ${sqlString(issue.source_row)}, ${sqlString(issue.severity)}, ${sqlString(issue.code)}, ${sqlString(issue.field)}, ${sqlString(issue.message)}, ${sqlString(JSON.stringify(issue.details))}) ON CONFLICT(manifest_id, record_index, code, field) DO NOTHING;`
    );
    postStatements++;
  }

  // Permendagri warnings (0 expected)
  const permWarnings = permValidated.issues.filter((issue: ValidationIssue) => issue.severity === 'warning');
  for (const issue of permWarnings) {
    const issueId = `issue:${await hashObject({ manifest: permValidated.manifestId, issue })}`;
    postLines.push(
      `INSERT INTO ingestion_issues (id, manifest_id, record_index, source_pdf_page, source_row, severity, code, field, message, details) VALUES (${sqlString(issueId)}, ${sqlString(permValidated.manifestId)}, ${sqlNumber(issue.record_index)}, ${sqlNumber(issue.source_pdf_page)}, ${sqlString(issue.source_row)}, ${sqlString(issue.severity)}, ${sqlString(issue.code)}, ${sqlString(issue.field)}, ${sqlString(issue.message)}, ${sqlString(JSON.stringify(issue.details))}) ON CONFLICT(manifest_id, record_index, code, field) DO NOTHING;`
    );
    postStatements++;
  }

  // Update Pergub Manifest to completed
  const pergubSummary = {
    total_records: pergubValidated.summary.total_records,
    valid_records: pergubValidated.records.length,
    rejected_records: 0,
    errors: 0,
    warnings: pergubWarnings.length,
    duplicates: pergubWarnings.filter((i: ValidationIssue) => i.code.startsWith('duplicate_')).length,
    inserted_records: pergubValidated.records.length,
    unchanged_records: 0,
    persisted_issues: pergubWarnings.length
  };
  postLines.push(
    `UPDATE ingestion_manifests SET status='completed', inserted_count=${pergubValidated.records.length}, unchanged_count=0, warning_count=${pergubWarnings.length}, summary_json=${sqlString(JSON.stringify(pergubSummary))}, imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${sqlString(pergubValidated.manifestId)};`
  );
  postStatements++;

  // Update Permendagri Manifest to completed
  const permSummary = {
    total_records: permValidated.summary.total_records,
    valid_records: permValidated.records.length,
    rejected_records: 0,
    errors: 0,
    warnings: permWarnings.length,
    duplicates: 0,
    inserted_records: permValidated.records.length,
    unchanged_records: 0,
    persisted_issues: permWarnings.length
  };
  postLines.push(
    `UPDATE ingestion_manifests SET status='completed', inserted_count=${permValidated.records.length}, unchanged_count=0, warning_count=${permWarnings.length}, summary_json=${sqlString(JSON.stringify(permSummary))}, imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${sqlString(permValidated.manifestId)};`
  );
  postStatements++;

  postLines.push('COMMIT;');
  await writeChunk('99_post_ingestion.sql', 'post_ingestion', null, 0, postStatements, postLines.join('\n') + '\n');

  // 8. Generate and save manifest.json
  const totalSqlBytes = chunks.reduce((sum, c) => sum + c.bytes, 0);

  const manifest: ProductionExportManifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    target_database: 'njkb-api-production',
    datasets: {
      pergub: {
        path: PERGUB_PATH,
        expected_records: 62091,
        actual_records: pergubValidated.records.length,
        sha256: pergubSha
      },
      permendagri: {
        path: PERMENDAGRI_PATH,
        expected_records: 2783,
        actual_records: permValidated.records.length,
        sha256: permSha
      }
    },
    total_records: pergubValidated.records.length + permValidated.records.length,
    total_chunks: chunks.length,
    total_sql_bytes: totalSqlBytes,
    execution_order: executionOrder,
    chunks
  };

  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return manifest;
}

// CLI entrypoint if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('export-production-sql.ts')) {
  console.log('Generating production SQL chunks and manifest...');
  exportProductionSql()
    .then((manifest) => {
      console.log('Export completed successfully:');
      console.log(`- Total Records: ${manifest.total_records.toLocaleString()}`);
      console.log(`- Total Chunks: ${manifest.total_chunks}`);
      console.log(`- Total SQL Size: ${(manifest.total_sql_bytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`- Manifest: artifacts/production/manifest.json`);
    })
    .catch((err) => {
      console.error('Export failed:', err);
      process.exit(1);
    });
}
