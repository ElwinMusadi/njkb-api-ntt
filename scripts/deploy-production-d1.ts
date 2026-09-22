import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ProductionExportManifest } from './export-production-sql';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isLocal = args.includes('--local') || !isRemote;
const dbName = args.find((a, i) => args[i - 1] === '--database') ?? (isRemote ? 'njkb-api-production' : 'NJKB_DB');
const manifestPath = resolve(args.find((a, i) => args[i - 1] === '--manifest') ?? 'artifacts/production/manifest.json');

async function runWranglerExecute(sqlFilePath: string): Promise<void> {
  const cmdArgs = [
    'd1',
    'execute',
    dbName,
    isRemote ? '--remote' : '--local',
    `--file=${sqlFilePath}`
  ];

  return new Promise((res, rej) => {
    const proc = spawn('npx', ['wrangler', ...cmdArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        res();
      } else {
        rej(new Error(`Wrangler execution failed (code ${code}) for ${sqlFilePath}:\n${stderr || stdout}`));
      }
    });
  });
}

export async function deployProductionD1(): Promise<void> {
  console.log(`Loading deployment manifest from ${manifestPath}...`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProductionExportManifest;

  console.log(`Target: ${isRemote ? 'REMOTE Cloudflare D1' : 'LOCAL Miniflare D1'}`);
  console.log(`Database: ${dbName}`);
  console.log(`Total Records: ${manifest.total_records.toLocaleString()}`);
  console.log(`Total Chunks: ${manifest.total_chunks}`);

  const startTime = Date.now();
  const artifactsDir = resolve('artifacts/production');

  for (let i = 0; i < manifest.execution_order.length; i++) {
    const filename = manifest.execution_order[i];
    const chunkPath = join(artifactsDir, filename);
    const chunkStart = Date.now();

    process.stdout.write(`[${i + 1}/${manifest.total_chunks}] Executing ${filename}... `);
    await runWranglerExecute(chunkPath);
    console.log(`OK (${Date.now() - chunkStart}ms)`);
  }

  console.log(`\nAll ${manifest.total_chunks} chunks deployed successfully in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('deploy-production-d1.ts')) {
  deployProductionD1().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
  });
}
