/* Aircraft presentation parity regression. The former persistent-smoke fixture
 * was superseded by Kaisen's hit/kill particles. No production state injection. */
const { spawnSync } = require('node:child_process');
for (const args of [
  ['--import','tsx','--test','tests/aircraft-vfx.test.ts'],
  ['node_modules/@playwright/test/cli.js','test','browser-tests/aircraft-parity.spec.ts','--grep','real Easy destruction'],
]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
