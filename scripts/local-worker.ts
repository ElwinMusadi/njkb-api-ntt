import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import fixture from '../fixtures/verified.json';
import { importDataset } from '../src/db/import';

const mf=new Miniflare({
 host:'127.0.0.1',port:8787,modules:true,scriptPath:'dist/index.js',
 compatibilityDate:'2026-06-11',d1Databases:['NJKB_DB'],
 bindings:{BPAD_TIMEOUT_MS:'5000',BPAD_ENDPOINT:'http://127.0.0.1:8788',NJKB_RESOLUTION_AS_OF:'2026-09-20'}
});

const db=await mf.getD1Database('NJKB_DB') as unknown as D1Database;
for(const file of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort()) {
 const sql=await readFile(`migrations/${file}`,'utf8');
 const statements=sql.trim().split(/;\s*\n/).map(value=>value.trim()).filter(Boolean);
 await db.batch(statements.map(statement=>db.prepare(statement)));
}
await importDataset(db,fixture);
console.log(`Local Worker listening on ${(await mf.ready).toString()}`);

const close=async()=>{await mf.dispose();process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);
