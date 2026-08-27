import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
for(const file of ['learning-api-hook.js','library-policy-hook.js','public/js/athlete-learning.js','public/js/coach-learning.js','public/js/coach-v9-session-generator-fix.js']){
  console.log(`CHECK ${file}`);
  execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
}
console.log('OK RunFlow Learning V1 syntax');
