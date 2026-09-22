import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { csvRecords } from './csv';
import type { SourceFormat } from './types';

export interface LoadedDataset {input:unknown;sourceFormat:SourceFormat;}

export async function loadCanonicalDataset(path:string):Promise<LoadedDataset> {
 const extension=extname(path).toLowerCase();
 if(extension==='.json') return {input:JSON.parse(await readFile(path,'utf8')),sourceFormat:'json'};
 if(extension==='.csv') {
  const sidecar=JSON.parse(await readFile(`${path}.manifest.json`,'utf8')) as Record<string,unknown>;
  if(sidecar.records!==undefined) throw new Error('CSV manifest sidecar must not contain records');
  return {input:{...sidecar,records:csvRecords(await readFile(path,'utf8'))},sourceFormat:'csv'};
 }
 throw new Error('Dataset must use .json or .csv');
}
