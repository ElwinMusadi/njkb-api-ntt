import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ProductionExportManifest } from './export-production-sql';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isLocal = args.includes('--local') || !isRemote;
const dbName = args.find((a, i) => args[i - 1] === '--database') ?? (isRemote ? 'njkb-api-production' : 'NJKB_DB');
const manifestPath = resolve(args.find((a, i) => args[i - 1] === '--manifest') ?? 'artifacts/production/manifest.json');
const startAt = args.find((a, i) => args[i - 1] === '--start-at') ?? null;
const maxNetworkAttempts=3;

function sha256(value:Buffer|string):string {return createHash('sha256').update(value).digest('hex');}
function hasUnsupportedTransaction(sql:string):boolean {
  const withoutComments=sql.replace(/^\s*--.*$/gm,'');
  return /\b(?:BEGIN\s+TRANSACTION|COMMIT|SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO)\b/i.test(withoutComments);
}

export function isTransientNetworkFailure(message:string):boolean {
  return /fetch failed|connectivity issue|network|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message);
}
function wait(ms:number):Promise<void> {return new Promise(resolvePromise=>setTimeout(resolvePromise,ms));}
async function runWranglerExecuteOnce(sqlFilePath: string): Promise<void> {
  const cmdArgs = [
    'd1',
    'execute',
    dbName,
    isRemote ? '--remote' : '--local',
    `--file=${sqlFilePath}`
  ];

  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...cmdArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
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
async function runWranglerExecute(sqlFilePath:string):Promise<number> {
  for(let attempt=1;attempt<=maxNetworkAttempts;attempt++) {
   try {await runWranglerExecuteOnce(sqlFilePath);return attempt;}
   catch(error) {
    const message=error instanceof Error?error.message:String(error);
    if(!isTransientNetworkFailure(message)||attempt>=maxNetworkAttempts) throw error;
    const delayMs=attempt*1_000;
    console.warn(`Transient network failure (attempt ${attempt}/${maxNetworkAttempts}); retrying in ${delayMs}ms...`);
    await wait(delayMs);
   }
  }
  throw new Error('Unreachable retry state');
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
  if(manifest.execution_order.length!==manifest.total_chunks) throw new Error('Manifest chunk count mismatch');
  const chunkByName=new Map(manifest.chunks.map(chunk=>[chunk.filename,chunk]));

  for (const filename of manifest.execution_order) {
    const chunk=chunkByName.get(filename);if(!chunk) throw new Error(`Manifest missing chunk metadata: ${filename}`);
    const content=await readFile(join(artifactsDir,filename));
    if(content.length!==chunk.bytes) throw new Error(`Chunk byte length mismatch: ${filename}`);
    if(sha256(content)!==chunk.sha256) throw new Error(`Chunk SHA-256 mismatch: ${filename}`);
    if(hasUnsupportedTransaction(content.toString('utf8'))) throw new Error(`Unsupported explicit transaction found: ${filename}`);
  }

  console.log('Artifact hash and SQL compatibility preflight: PASS');
  const startIndex=startAt===null?0:manifest.execution_order.indexOf(startAt);
  if(startAt!==null&&startIndex<0) throw new Error(`Resume chunk not found in manifest: ${startAt}`);
  if(startIndex>0) console.log(`Resume mode: starting at chunk ${startIndex+1}/${manifest.total_chunks} (${startAt})`);
  for (let i = startIndex; i < manifest.execution_order.length; i++) {
    const filename = manifest.execution_order[i];
    const chunkPath = join(artifactsDir, filename);
    const chunkStart = Date.now();

    process.stdout.write(`[${i + 1}/${manifest.total_chunks}] Executing ${filename}... `);
    const attempts=await runWranglerExecute(chunkPath);
    console.log(`OK (${Date.now() - chunkStart}ms, attempts=${attempts})`);
  }

  console.log(`\nAll ${manifest.total_chunks} chunks deployed successfully in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('deploy-production-d1.ts')) {
  deployProductionD1().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
  });
}
