'use strict';
/* #793: the uninstall retires this Mac at the coordinator BEFORE it destroys
   the key it signs with. After `rm -rf "$KOSMOS_HOME"` the connector is gone,
   and after the remote/ state is gone the key is; a retire placed after either
   can never fire, and a name would stay held forever. Static: order in the
   source, so it fails at the commit. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

test('#793: the uninstall calls retire while the connector and the key both still exist', () => {
  const retire = SETUP.indexOf('"$_tunnel" retire --state-dir "$_remote_state"');
  const keyGone = SETUP.indexOf('rm -rf "$_remote_state"');
  const homeGone = SETUP.indexOf('      rm -rf "$KOSMOS_HOME"\n');
  assert.ok(retire > -1, 'the uninstall no longer retires the Mac');
  assert.ok(keyGone > retire, 'the key is destroyed before retire runs');
  assert.ok(homeGone > retire, 'the connector is removed before retire runs');
  assert.match(SETUP.slice(retire, retire + 600), /could not be told/, 'a failed retire is not said');
});
