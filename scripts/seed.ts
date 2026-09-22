import { readFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import { importDataset } from '../src/db/import';
// Local-only: no remote mode, credentials or production writes.
const platform=await getPlatformProxy<{NJKB_DB:D1Database}>({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'}});
try {
 const path=process.argv[2] ?? 'fixtures/verified.json';
 console.log(JSON.stringify(await importDataset(platform.env.NJKB_DB,JSON.parse(await readFile(path,'utf8')))));
} finally {await platform.dispose();}
