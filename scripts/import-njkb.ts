import { writeFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import { importCanonicalDataset } from '../src/ingestion/importer';
import { loadCanonicalDataset } from '../src/ingestion/load';

const datasetPath=process.argv[2];
if(!datasetPath) {
 console.error('Usage: npm run import:njkb -- <dataset.json|dataset.csv> [--report <report.json>]');
 process.exit(1);
}
const reportFlag=process.argv.indexOf('--report');
const reportPath=reportFlag>=0&&process.argv[reportFlag+1]?process.argv[reportFlag+1]:`${datasetPath}.import-report.json`;
const loaded=await loadCanonicalDataset(datasetPath);
// Local-only by design. Production imports require an explicit reviewed workflow.
const platform=await getPlatformProxy<{NJKB_DB:D1Database}>({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'}});
try {
 const report=await importCanonicalDataset(platform.env.NJKB_DB,loaded.input,loaded.sourceFormat);
 await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
 console.log(JSON.stringify({status:report.status,manifest_id:report.manifest_id,summary:report.summary,report:reportPath}));
 if(report.status==='rejected') process.exitCode=2;
} finally {await platform.dispose();}
