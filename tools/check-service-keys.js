'use strict';
/* kosmos#6587: check the service key set staged in <engine dir> with the verifier and recovery keys staged beside it
   (tools/lib/stage-service-keys.sh). Prints the answer; exits 0 for ok or off (no recovery key pinned yet), 1 otherwise. */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '');
let r;
try {
  const sk = require(path.join(dir, 'servicekeys.js'));
  r = sk.verifyServiceKeySet({ bytes: fs.readFileSync(path.join(dir, 'service-keys.json')), sig: fs.readFileSync(path.join(dir, 'service-keys.json.sig'), 'utf8') });
} catch (e) {
  console.error('could not check the service key set in ' + dir + ': ' + e.message);
  process.exit(1);
}
if (r && r.off === true) { console.log('service key set: off (no recovery key pinned in this build)'); process.exit(0); }
if (r && r.ok === true) { console.log('service key set: verified, seq ' + r.seq + ', ' + r.keys.length + ' key(s)'); process.exit(0); }
console.error('service key set: refused: ' + (r && r.why));
process.exit(1);
