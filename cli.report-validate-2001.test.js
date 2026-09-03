'use strict';
/**
 * kosmos#2001. `blocked` and `needs_you` are the only two report states that
 * exist to SUMMON A PERSON; every other state is informational. Before this fix
 * `kosmos report blocked` with no --on, no --owner and no note recorded fine,
 * exit 0, no warning -- a red flag that names nothing anyone can act on. The fix
 * (branch A on the card): refuse those two states, BEFORE the network, unless
 * they carry at least one of --on, --owner, or a note. Informational states stay
 * free-form.
 *
 * 🛑 EVERY ARM PINS KOSMOS_PORT AT A DEAD PORT (the cli.post-attach-1955 pattern):
 * port 9 (discard) is not listening, so `healthy()` fails and any path that
 * reaches the network says "not running" out loud. That is what makes "was it
 * refused BEFORE the network?" observable -- a refused report never prints
 * "not running", an accepted one does.
 *
 * ⭐ THE CONTROL ARM IS LOAD-BEARING. A guard that refused EVERY empty report
 * would pass the blocked/needs_you arms; the control proves an informational
 * state with nothing is NOT refused and still reaches the send path, so this
 * file can tell "scoped to the two summoning states" from "intercepts everything".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DEAD = { ...process.env, KOSMOS_PORT: '9' };

function run(args) {
  return new Promise((resolve) => {
    execFile('bash', [CLI, ...args], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('#2001: `report blocked` with nothing is refused before the network', async () => {
  const r = await run(['report', 'blocked']);
  assert.match(r.out, /needs at least one of --on/, 'the empty summons did not get the refusal message');
  assert.doesNotMatch(r.out, /not running/, 'it reached healthy(), so it was recorded, not refused');
  assert.equal(r.code, 2, 'a refused summons should exit 2 (usage), not silently record');
});

test('#2001: `report needs_you` with nothing is refused too', async () => {
  const r = await run(['report', 'needs_you']);
  assert.match(r.out, /needs at least one of --on/);
  assert.doesNotMatch(r.out, /not running/);
  assert.equal(r.code, 2);
});

test('#2001: any ONE of --on, --owner or a note lets a summoning state through', async () => {
  const forms = [
    ['report', 'blocked', '--on', 'provider api'],
    ['report', 'blocked', '--owner', 'provider'],
    ['report', 'needs_you', 'which venue for the party?'],
    ['report', 'needs_you', '--on', 'the font choice'],
  ];
  for (const args of forms) {
    const r = await run(args);
    assert.doesNotMatch(r.out, /needs at least one of --on/, `wrongly refused a summons that carried content: ${args.join(' ')}`);
    assert.match(r.out, /not running/, `did not reach the send path (so the content check is too strict): ${args.join(' ')}`);
  }
});

test('#2001 CONTROL: an informational state with nothing is NOT refused (guard is scoped)', async () => {
  for (const state of ['started', 'working', 'idle', 'stopped']) {
    const r = await run(['report', state]);
    assert.doesNotMatch(r.out, /needs at least one of --on/, `${state} was wrongly required to carry content`);
    assert.match(r.out, /not running/, `${state} did not reach the send path`);
  }
});
