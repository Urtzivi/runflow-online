import path from 'node:path';
import { execFileSync } from 'node:child_process';
const file=path.join(process.cwd(),'learning-api-hook.js');
console.log('CHECK learning-api-hook.js');
execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log('OK learning-api-hook.js');
