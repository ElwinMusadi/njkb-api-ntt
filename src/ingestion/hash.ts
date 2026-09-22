function stable(value:unknown):unknown {
 if(Array.isArray(value)) return value.map(stable);
 if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value as Record<string,unknown>)
  .filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)]));
 return value;
}
export function stableJson(value:unknown):string {return JSON.stringify(stable(value));}
export async function sha256(value:string):Promise<string> {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function hashObject(value:unknown):Promise<string> {return sha256(stableJson(value));}
