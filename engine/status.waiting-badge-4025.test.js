'use strict';
/*
 * #4025: status.waitingBadgeOn, the switch for the waiting count on the app icon. On unless the
 * stored settings say exactly false.
 *
 *   node --test engine/status.waiting-badge-4025.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

test('#4025: off only when the settings say exactly false', () => {
  assert.equal(status.waitingBadgeOn({ waitingBadge: false }), false, 'switched off still counted');
  assert.equal(status.waitingBadgeOn({ waitingBadge: true }), true);
  assert.equal(status.waitingBadgeOn({}), true, 'a never-set switch is on (the default)');
  assert.equal(status.waitingBadgeOn(null), true, 'no settings is the default');
  assert.equal(status.waitingBadgeOn({ waitingBadge: 'false' }), true, 'a string is not a stored Off');
  assert.equal(status.waitingBadgeOn({ waitingBadge: 0 }), true, 'nor is 0');
});
