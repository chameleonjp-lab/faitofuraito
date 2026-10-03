import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=process.argv[2];if(!root)throw new Error('Usage: node scripts/check-aircraft-source.mjs <Kaisen checkout>');
const manifest=JSON.parse(readFileSync(new URL('../docs/aircraft-parity-manifest.json',import.meta.url),'utf8'));
let changed=0;
for(const entry of manifest.sourceFiles){
 const bytes=readFileSync(resolve(root,entry.path));
 const hash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 if(hash!==entry.gitBlobSha){console.error(`CHANGED ${entry.path}: ${entry.gitBlobSha} -> ${hash}`);changed++;}
}
if(changed){process.exitCode=1;console.error('Review aircraft changes and adapters; never auto-copy whole-game files.');}
else console.log(`Aircraft reference matches ${manifest.publishedSourceSha}`);
