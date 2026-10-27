'use strict';
/**
 * kosmos#4903 seam H (Mona Lisa's table, 09:36Z on the card): on a Kosmos cloud machine the board says "your cloud
 * machine", never "this computer", and hides what a person in a browser cannot do (a path on the machine, a login to it,
 * a terminal on it). Seam G: the first-run Connect list offers Claude alone there.
 *
 * Each painter below is the page's own source, lifted, run once as a cloud machine and once as the board it was
 * before (the CONTROL), so a check that would pass either way shows up as a failing control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

const run = (names, body, env) => {
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, page.liftAll(SCRIPT, names) + '\n' + body)(...keys.map((k) => env[k]));
};
const machine = (cloud, platform) => ({
  onCloudMachine: () => cloud,
  onLinux: (p) => (p || platform) === 'linux',
  onWindows: (p) => (p || platform) === 'win32',
});

test('#4903 seam H: thisMachine and hostMachine say "your cloud machine" only on a cloud machine, and an explicit platform is never the cloud', () => {
  const words = (cloud, platform, arg) => run(['thisMachine', 'ThisMachine', 'hostMachine', 'hostMachineCap'],
    'return [thisMachine(), ThisMachine(), hostMachine(' + (arg ? JSON.stringify(arg) : '') + '), hostMachineCap(' + (arg ? JSON.stringify(arg) : '') + ')];',
    machine(cloud, platform));
  assert.deepEqual(words(true, 'linux'), ['your cloud machine', 'Your cloud machine', 'your cloud machine', 'Your cloud machine']);
  // CONTROLS: a plain Linux server, a Mac, and another computer's payload described from a cloud board.
  assert.deepEqual(words(false, 'linux'), ['this computer', 'This computer', 'the computer running Kosmos', 'The computer running Kosmos']);
  assert.deepEqual(words(false, 'darwin'), ['this computer', 'This computer', 'your Mac', 'Your Mac']);
  assert.deepEqual(words(true, 'linux', 'darwin').slice(2), ['your Mac', 'Your Mac'], 'an explicit platform took the cloud words');
});

test('#4903 seam H: the signed-out panel on a cloud machine sends the person to login.kosmosplus.com, not to Kosmos+ or a computer', () => {
  const html = (cloud) => run(['boardSigninHtml'], 'return boardSigninHtml();',
    Object.assign(machine(cloud, 'linux'), { kplusRemote: () => true, linuxCopy: () => 'LINUX', platformCopy: (k, mac) => mac }));
  const cloud = html(true);
  assert.match(cloud, /This page is signed out\./);
  assert.match(cloud, /sign in at <b>login\.kosmosplus\.com<\/b> and press Open my Kosmos/);
  assert.match(cloud, /data-board-retry/, 'the Reload button is gone');
  assert.doesNotMatch(cloud, /Kosmos\+|computer it runs on/);
  // CONTROL: the same board reached through Kosmos+ from a phone keeps its words.
  assert.match(html(false), /cannot read your agents or projects through Kosmos\+/);
});

test('#4903 seam H: "No agents yet" says the agent runs on the cloud machine and keeps going with the person\'s own computer off', () => {
  const env = (cloud) => Object.assign(machine(cloud, 'linux'), {
    BOARD_DEVICE_OFFLINE: false, BOARD_SIGNED_OUT: false, BOARD_NEEDS_SIGNIN: false, BOARD_LOOK_FAILED: false, BOARD_SEEN: true,
    kplusRemote: () => true, esc: (s) => String(s),
  });
  const cloud = run(['boardEmpty'], 'return boardEmpty();', env(true));
  assert.match(cloud, /runs on your cloud machine and keeps going while you are away, even with your own computer off\./);
  assert.doesNotMatch(cloud, /this computer/);
  assert.match(run(['boardEmpty'], 'return boardEmpty();', env(false)), /runs on this computer and keeps going while you get on with something else\./, 'CONTROL');
});

test('#4903 seam H: the restart and Start at login notices are not even looked for on a cloud machine', async () => {
  const look = async (hide) => {
    const slot = { innerHTML: 'OLD', dataset: { v: '1' } };
    let fetched = 0;
    await run(['paintSurvival'], 'return paintSurvival();', {
      cloudHidesRestart: () => hide, SURVIVAL_BUSY: false,
      document: { getElementById: (id) => (id === 'survival-slot' ? slot : null) },
      fetch: async () => { fetched += 1; return { ok: false }; },
    });
    return { slot, fetched };
  };
  const cloud = await look(true);
  assert.equal(cloud.fetched, 0, 'the cloud machine still asked /api/register');
  assert.equal(cloud.slot.innerHTML, '', 'a notice already shown was left up');
  assert.equal((await look(false)).fetched, 1, 'CONTROL: off the cloud the look runs, so the zero above means something');
  // The switch that brings them back if the box does not restart agents by itself (Baron confirms on a test box).
  assert.match(SCRIPT, /\nconst CLOUD_HIDES_RESTART = true;\n/);
  assert.equal(run(['cloudHidesRestart'], 'return [cloudHidesRestart()];', { CLOUD_HIDES_RESTART: false, onCloudMachine: () => true })[0], false,
    'turning the switch off did not bring the notices back');
});

test('#4903 seam H: applyPlatformCopy stamps the cloud mark (which data-cloud-hide keys on) and fills data-cloud-copy, only on a cloud machine', () => {
  const stamp = (cloud) => {
    const attrs = {};
    const el = { textContent: 'this computer', getAttribute: () => 'thisMachine' };
    const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
    const root = { querySelectorAll: (q) => (q === '[data-cloud-copy]' ? [el] : []) };
    run(['applyPlatformCopy', 'thisMachine'], 'applyPlatformCopy(root);', Object.assign(machine(cloud, 'linux'), {
      document, root, linuxCopy: () => '', window: undefined,
    }));
    return { attrs, text: el.textContent };
  };
  assert.deepEqual(stamp(true), { attrs: { 'data-kosmos-cloud': '1', 'data-kosmos-platform': 'linux' }, text: 'your cloud machine' });
  assert.deepEqual(stamp(false), { attrs: { 'data-kosmos-platform': 'linux' }, text: 'this computer' }, 'CONTROL');
  assert.match(PAGE, /html\[data-kosmos-cloud\] \[data-cloud-hide\] \{ display: none !important; \}/);
});

test('#4903 seam H: the import from a folder is hidden on a cloud machine, whole: the path field, its help and the found list', () => {
  const at = PAGE.indexOf('<div data-cloud-hide>\n        <label class="flabel" for="import-folder">');
  assert.ok(at > -1, 'the folder import is not inside a data-cloud-hide block');
  const block = PAGE.slice(at, PAGE.indexOf('</div>\n        <p class="rolelimit" id="import-msg"', at));
  assert.match(block, /id="import-folder"/);
  assert.match(block, /Point at an agent’s folder on this computer/);
  assert.match(PAGE, /<div class="import-found" id="import-found" data-cloud-hide hidden><\/div>/);
});

test('#4903 seam G: the first-run Connect list offers Claude alone on a cloud machine (every other row data-cloud-hide)', () => {
  const pane = PAGE.slice(PAGE.indexOf('id="fr-pane-5"'), PAGE.indexOf('id="fr-pane-6"'));
  assert.ok(pane.length > 1000, 'the Connect pane was not found; the checks below test nothing');
  const rows = [...pane.matchAll(/<div ((?:data-cloud-hide )?)class="llm[ "][^>]*><span class="llm-m[^"]*" data-pmark="([a-z]+)"/g)]
    .map((m) => [m[2], m[1] !== '']);
  assert.ok(rows.length >= 10, 'fewer provider rows than the list has: ' + JSON.stringify(rows));
  assert.deepEqual(rows.filter(([prov]) => prov === 'claude'), [['claude', false]], 'no shown Claude row was found; the loop below could pass with Claude gone');
  for (const [prov, hidden] of rows) assert.equal(hidden, prov !== 'claude', prov + (hidden ? ' is hidden' : ' is shown') + ' on a cloud machine');
  // Review 1: each hidden provider's panels and status box go too (its painters still run on entering the step).
  for (const id of ['openai-confirm', 'openai-pick', 'openai-sub-step', 'openai-flow', 'openai-msg', 'gemini-confirm', 'gemini-pick',
    'gemini-sub-step', 'gemini-flow', 'gemini-msg', 'grok-confirm', 'grok-pick', 'grok-sub-step', 'grok-flow', 'grok-msg', 'muse-flow', 'muse-msg']) {
    assert.match(pane, new RegExp('<div data-cloud-hide (?:class="dhint" )?id="fr-' + id + '"'), 'fr-' + id + ' is shown on a cloud machine');
  }
  assert.doesNotMatch(pane, /<div (?!data-cloud-hide)[^>]*id="fr-(?:openai|gemini|grok|muse)-(?:confirm|pick|sub-step|flow|msg)"/, 'a provider panel is outside the cloud hide');
  // Review 2: the age line naming OpenAI and Grok is hidden; a cloud machine says Claude's rule alone.
  assert.match(pane, /<p class="fr-age" data-cloud-only>Claude needs you to be 18 or over\. Age rules vary by country\.<\/p>\n\s*<p class="fr-age" id="fr-age" data-cloud-hide>/);
  assert.match(PAGE, /html:not\(\[data-kosmos-cloud\]\) \[data-cloud-only\] \{ display: none !important; \}/);
});

test('#4903 seam H review 3: the found list (hidden there) does not scan on a cloud machine; the Show again list stays empty', async () => {
  const wrap = { innerHTML: 'OLD' };
  let scanned = 0;
  await run(['populateFoundImports'], 'return populateFoundImports();', {
    onCloudMachine: () => true, document: { getElementById: (id) => (id === 'import-found' ? wrap : null) },
    fetch: async () => { scanned += 1; return { ok: false, json: async () => ({}) }; }, FR_IMPORT_POP_GEN: 0,
  });
  assert.equal(scanned, 0, 'a cloud machine still scanned for agent files');
  assert.equal(wrap.innerHTML, '');
  const box = { hidden: false }; const list = { innerHTML: 'OLD' };
  run(['paintSurvivalHidden'], 'paintSurvivalHidden({ hidden: ["a"] });', {
    cloudHidesRestart: () => true, document: { getElementById: (id) => (id === 'survival-hidden-box' ? box : id === 'survival-hidden-list' ? list : null) },
  });
  assert.deepEqual([box.hidden, list.innerHTML], [true, ''], 'the Show again list of restart notices showed on a cloud machine');
});

test('#4903 seam H: the page\'s own "this computer" sentences on the agent, its files and the create flow go through thisMachine', () => {
  const T = "(typeof thisMachine === 'function' ? thisMachine() : 'this computer')";
  const TC = "(typeof ThisMachine === 'function' ? ThisMachine() : 'This computer')";
  for (const said of [
    "'Not on ' + " + T,
    "'<option value=\"\">The OpenAI sign-in on ' + " + T + " + '</option>'",
    "'<option value=\"\">' + " + TC + " + '\\'s own '",
    "'subscription and uses ' + " + T + " + '\\'s memory. Start all '",
    "trusted hooks can act freely on ' + " + T + " + '. If you are not sure",
    "'This agent has no folder of its own on ' + " + T + " + ', so there is no Files list.'",
    "'Kosmos has no folder for ' + name + ' on ' + " + T + " + ', so it has nowhere to write.'",
    "const head = " + TC + " + ' restarted ' + down;",
    "account this agent runs on is no longer on ' + " + T + " + ', so it cannot run. '",
    "' running on ' + " + T + " + '.'",
    'Your agents run on your own subscription, on <span data-cloud-copy="thisMachine">this computer</span>.',
    "'It keeps trying each time your cloud machine starts. If it appears under Agents, you can remove it there.'",
    'where they live on <span data-cloud-copy="thisMachine">this computer</span>',
    '(cloud ? CLOUD_ASLEEP_SENTENCE : MAC_ASLEEP_SENTENCE + at)',
  ]) assert.ok(PAGE.includes(said), 'missing: ' + said);
  assert.match(SCRIPT, /const CLOUD_ASLEEP_SENTENCE = 'It may be restarting, and this page asks again by itself\./);
  // None of the swapped sentences is left in its old fixed form.
  for (const old of ["'Not on this computer'", 'The OpenAI sign-in on this computer', "uses this computer\\'s memory", 'act freely on this computer',
    'no folder of its own on this computer, so there is no Files list', "' on this computer, so it has nowhere", "'This computer restarted '"]) {
    assert.ok(!PAGE.includes(old), 'still fixed: ' + old);
  }
});
