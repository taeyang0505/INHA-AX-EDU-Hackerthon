import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../tests/',import.meta.url));
for(const file of (await readdir(dir)).filter(n=>n.endsWith('.test.cjs')).sort()){
 const result=spawnSync(process.execPath,[dir+file],{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
