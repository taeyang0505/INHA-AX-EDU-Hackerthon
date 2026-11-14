import {readdir,readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=path.join(root,'dist');
for(const name of await readdir(dist)){
 if(!name.endsWith('.js'))continue;
 const result=spawnSync(process.execPath,['--check',path.join(dist,name)],{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
const html=await readFile(path.join(dist,'index.html'),'utf8');
for(const [,asset] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 if(asset.startsWith('#')||/^(https?:|data:)/.test(asset))continue;
 await access(path.join(dist,asset));
}
console.log('PASS: JavaScript syntax and index.html local assets.');
