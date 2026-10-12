'use strict';
/* kosmos#5871: which id names this computer now (engine/enrolment.js currentMacIdBy), the same rule as the tunnel's
   MacState::identity_record. Pure: the files are a map, their times a second map. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { currentMacIdBy, IDENTITY_FILE } = require('./enrolment');

const pick = (files, times = {}) => currentMacIdBy(
  (f) => (f in files ? files[f] : null),
  (f) => (f in times ? times[f] : null));

test('#5871: with no mac_identity the mac_id file names the computer (registered before the file existed)', () => {
  assert.equal(pick({ mac_id: 'mac-old\n' }), 'mac-old');
  assert.equal(pick({}), null);
});

test('#5871: mid-registration, mac_identity (written first, newer) names the computer, not the older mac_id', () => {
  const files = { [IDENTITY_FILE]: 'mac-new\nKEY\n', mac_id: 'mac-old' };
  assert.equal(pick(files, { [IDENTITY_FILE]: 2000, mac_id: 1000 }), 'mac-new');
  // A tie keeps mac_identity.
  assert.equal(pick(files, { [IDENTITY_FILE]: 1000, mac_id: 1000 }), 'mac-new');
});

test('#5871: an older tunnel registered since (a NEWER mac_id naming another id) names the computer', () => {
  const files = { [IDENTITY_FILE]: 'mac-stale\nKEY\n', mac_id: 'mac-fresh' };
  assert.equal(pick(files, { [IDENTITY_FILE]: 1000, mac_id: 2000 }), 'mac-fresh');
  // CONTROL: the same id in a newer mac_id is the completed registration, and mac_identity names it.
  assert.equal(pick({ [IDENTITY_FILE]: 'mac-a\nKEY\n', mac_id: 'mac-a' }, { [IDENTITY_FILE]: 1000, mac_id: 2000 }), 'mac-a');
});

test('#5871: a mac_identity with no id is no id, never the other file\'s', () => {
  assert.equal(pick({ [IDENTITY_FILE]: '\nKEY\n', mac_id: 'mac-x' }, { [IDENTITY_FILE]: 1000, mac_id: 2000 }), null);
});

test('#5871: with no mac_id file, mac_identity names the computer', () => {
  assert.equal(pick({ [IDENTITY_FILE]: 'mac-only\nKEY\n' }), 'mac-only');
});
