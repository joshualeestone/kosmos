"use strict";
/**
 * #1786: a hand-edited (dirty) create-agent form must not persist across role re-picks.
 *
 * refillDetails(resetDirty) is the single choke-point: step two (cstep('name')) is reached
 * ONLY through the role-next handler, which calls refillDetails(roleChanged). Before this fix,
 * a role CHANGE reset only the two dirty-guarded fields (label, instructions); name, avatar and
 * projects were reset in openCreate and nowhere else, so a role re-pick left them carrying the
 * previous role's entries -- a half-reset form, and the false-completeness the card warns about.
 *
 * These run the SHIPPED function against a fake document, so what is under test is the code that
 * ships, not a paraphrase. resetDirty=true is a role change (reset the whole form to the new
 * template); resetDirty=false is re-entering step two with the SAME role (keep the person's words).
 *
 *   node --test web.create-role-reset-1786.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

const at = SCRIPT.indexOf('function refillDetails(resetDirty)');
assert.ok(at > 0, 'refillDetails moved; re-anchor this test');
const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);

// Run the real refillDetails against a fake document + stubbed globals, and report the
// observable state after the call.
function run(resetDirty, seed) {
  const els = {
    'create-name': { value: seed.name },
    'create-label': { value: seed.label },
    'create-instr': { value: seed.instr },
    'create-avatar': { value: seed.avatarInput },
    'genav-hint': { textContent: seed.hint },
    'create-instr-note': { textContent: 'stale' },
  };
  const document = { getElementById: (id) => els[id] };
  const wrap = `
    let INSTR_DIRTY = _s.dirty, LABEL_DIRTY = _s.dirty, AVATAR_FILE = _s.avatar,
        CREATE_PROJECTS = _s.projects, LAST_TYPED_NAME = 'x';
    const PICKED = 'pm';
    const roleByKey = () => ({ key: 'pm', label: 'Project Manager', instructions: 'pm {{NAME}}' });
    // Faithful to the real instrTemplate: it embeds create-name's value (the {{NAME}} slot),
    // so this exercises the load-bearing ordering (name cleared BEFORE the template refills).
    const instrTemplate = () => 'do the work, ' + (document.getElementById('create-name').value.trim() || 'your agent');
    ${fn}
    refillDetails(_resetDirty);
    return {
      name: document.getElementById('create-name').value,
      label: document.getElementById('create-label').value,
      instr: document.getElementById('create-instr').value,
      avatar: AVATAR_FILE,
      avatarInput: document.getElementById('create-avatar').value,
      hint: document.getElementById('genav-hint').textContent,
      projects: CREATE_PROJECTS,
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('document', '_s', '_resetDirty', wrap)(document, seed, resetDirty);
}

const DIRTY_SEED = {
  name: 'Alfred', label: 'My Own Label', instr: 'my own words',
  avatar: { name: 'pic.png' }, avatarInput: 'pic.png', hint: 'pic.png will be its picture', projects: ['proj-a'],
  dirty: true,
};

test('#1786: a role CHANGE (resetDirty=true) resets the WHOLE form, not just label+instructions', () => {
  const r = run(true, DIRTY_SEED);
  // The two fields that were already reset before this card:
  assert.equal(r.label, 'Project Manager', 'label did not reset to the new role template');
  assert.match(r.instr, /your agent/, 'instructions did not reset to the new role template');
  assert.doesNotMatch(r.instr, /Alfred/, 'the template embedded the STALE name: name must be cleared BEFORE instrTemplate() runs');
  // The fields this card adds -- the residue that used to persist:
  assert.equal(r.name, '', 'the name persisted across a role change (the measured residue)');
  assert.equal(r.avatar, null, 'the avatar file persisted across a role change');
  assert.equal(r.avatarInput, '', 'the avatar input was not cleared across a role change');
  assert.equal(r.hint, '', 'the avatar hint persisted across a role change');
  assert.deepEqual(r.projects, [], 'the picked projects persisted across a role change');
});

test('#1786: re-entering step two with the SAME role (resetDirty=false) keeps the person\'s words', () => {
  const r = run(false, DIRTY_SEED);
  // The dirty guard still protects hand-entered label/instructions on a same-role return.
  assert.equal(r.label, 'My Own Label', 'a same-role return wrongly cleared the edited label');
  assert.equal(r.instr, 'my own words', 'a same-role return wrongly cleared the edited instructions');
  // And the whole-form reset must NOT fire on a same-role return.
  assert.equal(r.name, 'Alfred', 'a same-role return wrongly cleared the name');
  assert.notEqual(r.avatar, null, 'a same-role return wrongly cleared the avatar');
  assert.deepEqual(r.projects, ['proj-a'], 'a same-role return wrongly cleared the projects');
});
