'use strict';
/* kosmos#5871: remote.js macIdHere is wired to the tunnel's rule (engine/enrolment.js currentMacIdBy), not to the
   mac_id file alone: with a newer mac_identity beside an older mac_id (a registration cut between the two), the app
   names the computer the tunnel signs as. Sandboxed data root and state folder before the require. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macid-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macid-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
const remote = require('./remote');

test.after(() => { for (const d of [SANDBOX, STATE]) fs.rmSync(d, { recursive: true, force: true }); });

test('#5871: macIdHere names the computer by mac_identity when a registration was cut before mac_id', () => {
  const old = new Date(Date.now() - 60000);
  fs.writeFileSync(path.join(STATE, 'mac_id'), 'mac-old');
  fs.utimesSync(path.join(STATE, 'mac_id'), old, old);
  assert.equal(remote.macIdHere(), 'mac-old', 'control: with no mac_identity, mac_id names it');
  fs.writeFileSync(path.join(STATE, 'mac_identity'), 'mac-new\nKEY\n');
  assert.equal(remote.macIdHere(), 'mac-new', 'macIdHere read mac_id alone, not the tunnel\'s rule');
  // Review 8: the mtimes reach the rule. An older connector registered since: a newer mac_id naming another id wins.
  const older = new Date(Date.now() - 120000);
  fs.utimesSync(path.join(STATE, 'mac_identity'), older, older);
  fs.writeFileSync(path.join(STATE, 'mac_id'), 'mac-later');
  assert.equal(remote.macIdHere(), 'mac-later', 'macIdHere did not see the files\' times');
});
