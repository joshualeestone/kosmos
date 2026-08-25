'use strict';
/**
 * Josh, #chaoskosmos-design, 2026-08-25: "I think we could also have 3-4
 * like personal or family type roles to inject as well." Proposed four
 * candidates rather than guess at his more tentative wording; he confirmed
 * all four ("Family roles sound great") and asked for the group at the
 * bottom of the list.
 *
 *   node --test engine/roles-personal.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const roles = require('./roles');

test('the four personal/family roles exist, in one new group, placed last', () => {
  const keys = ['household', 'family', 'personal', 'travel'];
  for (const k of keys) {
    const r = roles.byKey(k);
    assert.ok(r, `role '${k}' is missing`);
    assert.equal(r.group, 'Personal and family', `role '${k}' is not in the Personal and family group`);
  }
  // Array order is what determines menu group order (web/index.html builds
  // groups by first-appearance), so the group being last in ROLES is what
  // actually puts it at the bottom of the picker, not just a label choice.
  const menuGroups = [];
  for (const r of roles.ROLES.filter((x) => x.menu !== false)) {
    if (!menuGroups.includes(r.group)) menuGroups.push(r.group);
  }
  assert.equal(menuGroups[menuGroups.length - 1], 'Personal and family',
    'Personal and family is not the last group in menu order');
});

test('Personal Assistant and Travel Planner carry cautions, and state their own boundary', () => {
  const personal = roles.byKey('personal');
  assert.match(personal.caution, /never sends or books anything on its own/i);
  assert.match(personal.instructions, /Draft, never send or book/i);
  const travel = roles.byKey('travel');
  assert.match(travel.caution, /never books anything/i);
  assert.match(travel.instructions, /do not book anything/i);
});

test('Household Manager and Family Coordinator each state what they cannot decide', () => {
  const household = roles.byKey('household');
  assert.match(household.instructions, /you do not book it or buy it yourself/i);
  const family = roles.byKey('family');
  assert.match(family.instructions, /you do not decide who goes where when two things conflict/i);
});
