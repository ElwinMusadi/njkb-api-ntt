import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Miniflare } from 'miniflare';
import { createEmptyTestDatabase } from './support';
import {
  exportProductionSql,
  EXPECTED_PERGUB_SHA256,
  EXPECTED_PERMENDAGRI_SHA256,
  type ProductionExportManifest
} from '../scripts/export-production-sql';
import { isTransientNetworkFailure } from '../scripts/deploy-production-d1';

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inComment) {
      if (char === '\n') inComment = false;
      continue;
    }

    if (inString) {
      current += char;
      if (char === "'") {
        if (next === "'") {
          current += next;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inComment = true;
      i++;
      continue;
    }

    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const finalTrimmed = current.trim();
  if (finalTrimmed.length > 0) statements.push(finalTrimmed);

  return statements;
}

describe('Production SQL Export and Deployment Pipeline', () => {
  let manifest: ProductionExportManifest;
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    manifest = await exportProductionSql({ chunkSize: 350 });
    const testDb = await createEmptyTestDatabase();
    mf = testDb.mf;
    db = testDb.db;
  });

  afterAll(async () => {
    await mf?.dispose();
  });

  it('classifies only network/connectivity failures as retryable',()=>{
    expect(isTransientNetworkFailure('fetch failed')).toBe(true);
    expect(isTransientNetworkFailure('A fetch request failed, likely due to a connectivity issue')).toBe(true);
    expect(isTransientNetworkFailure('ECONNRESET')).toBe(true);
    expect(isTransientNetworkFailure('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed')).toBe(false);
    expect(isTransientNetworkFailure('D1_ERROR: syntax error')).toBe(false);
  });

  it('generates a valid, deterministic production export manifest', () => {
    expect(manifest.schema_version).toBe(1);
    expect(manifest.total_records).toBe(64874);
    expect(manifest.datasets.pergub.expected_records).toBe(62091);
    expect(manifest.datasets.pergub.actual_records).toBe(62091);
    expect(manifest.datasets.pergub.sha256).toBe(EXPECTED_PERGUB_SHA256);

    expect(manifest.datasets.permendagri.expected_records).toBe(2783);
    expect(manifest.datasets.permendagri.actual_records).toBe(2783);
    expect(manifest.datasets.permendagri.sha256).toBe(EXPECTED_PERMENDAGRI_SHA256);

    expect(manifest.total_chunks).toBe(manifest.chunks.length);
    expect(manifest.execution_order.length).toBe(manifest.chunks.length);

    // Every exact generated chunk is bounded and remote-D1 compatible.
    for (const chunk of manifest.chunks) {
      expect(chunk.bytes).toBeLessThan(1024 * 1024);
      expect(chunk.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(chunk.statement_count).toBeGreaterThan(0);
    }
  });

  it('emits no explicit transaction statements in any exact artifact',async()=>{
    for(const chunk of manifest.chunks) {
      const sql=await readFile(join('artifacts/production',chunk.filename),'utf8');
      const withoutComments=sql.replace(/^\s*--.*$/gm,'');
      expect(withoutComments).not.toMatch(/\bBEGIN\s+TRANSACTION\b/i);
      expect(withoutComments).not.toMatch(/\bCOMMIT\b/i);
      expect(withoutComments).not.toMatch(/\bSAVEPOINT\b/i);
    }
  });

  it('executes metadata chunk 00 and verifies initial tables and scope', async () => {
    const metaSql = await readFile(join('artifacts/production', '00_metadata.sql'), 'utf8');
    const stmts = splitSqlStatements(metaSql);
    expect(stmts.length).toBe(8);

    for (const stmt of stmts) {
      await db.prepare(stmt).run();
    }

    const regs = (await db.prepare('SELECT count(*) as n FROM regulations').first<{ n: number }>())?.n;
    const docs = (await db.prepare('SELECT count(*) as n FROM source_documents').first<{ n: number }>())?.n;
    const eds = (await db.prepare('SELECT count(*) as n FROM reference_editions').first<{ n: number }>())?.n;
    const mans = (await db.prepare('SELECT count(*) as n FROM ingestion_manifests').first<{ n: number }>())?.n;

    expect(regs).toBe(2);
    expect(docs).toBe(2);
    expect(eds).toBe(2);
    expect(mans).toBe(2);

    // Verify edition scopes
    const ed2025 = await db.prepare("SELECT * FROM reference_editions WHERE id='edition-2025'").first<{
      applicability_status: string;
      vehicle_year_min: number;
      vehicle_year_max: number;
    }>();
    expect(ed2025?.applicability_status).toBe('approved');
    expect(ed2025?.vehicle_year_min).toBe(1900);
    expect(ed2025?.vehicle_year_max).toBe(2025);

    const ed2026 = await db.prepare("SELECT * FROM reference_editions WHERE id='edition-2026'").first<{
      applicability_status: string;
      vehicle_year_min: number;
      vehicle_year_max: number;
    }>();
    expect(ed2026?.applicability_status).toBe('approved');
    expect(ed2026?.vehicle_year_min).toBe(2026);
    expect(ed2026?.vehicle_year_max).toBe(2026);
  });

  it('executes sample data chunks and maintains foreign keys and provenance', async () => {
    // Test first chunk of Pergub and Permendagri
    const sampleChunks = [
      'pergub_chunk_01.sql',
      'permendagri_chunk_01.sql'
    ];

    let insertedRecords = 0;

    for (const chunkFile of sampleChunks) {
      const sql = await readFile(join('artifacts/production', chunkFile), 'utf8');
      const stmts = splitSqlStatements(sql);
      expect(stmts.length).toBeGreaterThan(0);

      // Execute in batches of 100
      for (let i = 0; i < stmts.length; i += 100) {
        const batch = stmts.slice(i, i + 100);
        await db.batch(batch.map((s) => db.prepare(s)));
      }

      const chunkInfo = manifest.chunks.find((c) => c.filename === chunkFile);
      insertedRecords += chunkInfo?.record_count ?? 0;
    }

    const currentRefs = (await db.prepare('SELECT count(*) as n FROM njkb_references').first<{ n: number }>())?.n;
    const currentRecs = (await db.prepare('SELECT count(*) as n FROM ingestion_records').first<{ n: number }>())?.n;

    expect(currentRefs).toBe(insertedRecords);
    expect(currentRecs).toBe(insertedRecords);
  }, 120000);

  it('is completely idempotent when re-executing already applied SQL chunks', async () => {
    const beforeRefs = (await db.prepare('SELECT count(*) as n FROM njkb_references').first<{ n: number }>())?.n;
    const beforeRecs = (await db.prepare('SELECT count(*) as n FROM ingestion_records').first<{ n: number }>())?.n;

    // Re-execute 00_metadata.sql
    const metaSql = await readFile(join('artifacts/production', '00_metadata.sql'), 'utf8');
    for (const stmt of splitSqlStatements(metaSql)) {
      await db.prepare(stmt).run();
    }

    // Re-execute pergub_chunk_01.sql
    const chunkSql = await readFile(join('artifacts/production', 'pergub_chunk_01.sql'), 'utf8');
    const stmts = splitSqlStatements(chunkSql);
    for (let i = 0; i < stmts.length; i += 100) {
      const batch = stmts.slice(i, i + 100);
      await db.batch(batch.map((s) => db.prepare(s)));
    }

    const afterRefs = (await db.prepare('SELECT count(*) as n FROM njkb_references').first<{ n: number }>())?.n;
    const afterRecs = (await db.prepare('SELECT count(*) as n FROM ingestion_records').first<{ n: number }>())?.n;

    expect(afterRefs).toBe(beforeRefs);
    expect(afterRecs).toBe(beforeRecs);
  }, 120000);

  it('executes 99_post_ingestion chunk to record issues and complete manifests', async () => {
    const postSql = await readFile(join('artifacts/production', '99_post_ingestion.sql'), 'utf8');
    const stmts = splitSqlStatements(postSql);
    expect(stmts.length).toBe(78 + 2); // 78 issues + 2 manifest updates

    for (let i = 0; i < stmts.length; i += 50) {
      const batch = stmts.slice(i, i + 50);
      await db.batch(batch.map((s) => db.prepare(s)));
    }

    const issuesCount = (await db.prepare('SELECT count(*) as n FROM ingestion_issues').first<{ n: number }>())?.n;
    expect(issuesCount).toBe(78);

    const completedManifests = (
      await db.prepare("SELECT count(*) as n FROM ingestion_manifests WHERE status='completed'").first<{ n: number }>()
    )?.n;
    expect(completedManifests).toBe(2);
  });
});
