'use strict';

/*
 * kosmos#8868: an installed agent reported that the "Connecting providers, plugins and services" section of its own
 * instructions flipped between versions. The bad one said there is no command for the job, sent the agent to a direct
 * API read carrying a credential, and had no warning that reading GET /api/connections bills the person. Those are
 * the features of the block before #4451 (2026-09-29): "there is no one-word verb that prints accounts, so it is a
 * direct read of" GET /api/accounts with the board token, and no Connections part at all. Current main writes neither.
 *
 * This guards the block as current Kosmos writes it into an agent's file, and the repair of a file that already holds
 * the old text; connections.test.js pins the source wording. It cannot see a writer running other code (an older
 * Kosmos, or a board started from an old checkout), which is where the reported flip most likely came from; it makes
 * sure the next write from this code puts the accurate block back, and that every writer here uses the one text.
 * One shape is not repaired: a file holding TWO Connections marker pairs is refused by tellAgent on purpose (we
 * cannot tell which is ours; connections.test.js pins that), so its text stays until someone removes one pair.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-connaccurate-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const connections = require('./connections');
const projects = require('./projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const fileOf = (name) => path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md');
function agentFile(name, text) {
  fs.mkdirSync(path.dirname(fileOf(name)), { recursive: true });
  fs.writeFileSync(fileOf(name), text);
}
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

/* The section between Kosmos's markers, as the agent reads it. */
function section(text) {
  const a = text.indexOf(projects.CONNECTIONS_START);
  const b = text.indexOf(projects.CONNECTIONS_END);
  assert.ok(a >= 0 && b > a, 'the file has no Kosmos connections section');
  return text.slice(a + projects.CONNECTIONS_START.length, b).replace(/\s+/g, ' ');
}

/* "There is no command" in the spellings seen and their near rewordings ("no kosmos command", "no verb for this"). A
   tripwire, not the whole class: "cannot list" or "no way to see" are not caught. It matches words, so a future
   accurate text that says "there is no command for X yet" about something else would need this widened on purpose. */
const NO_COMMAND = /one-word verb|no such command|\bno (?:\w+ ){0,2}(?:command|verb)(?![\w-])|there is no (?:command|kosmos|verb)/i;

/* What an accurate section must say, and what the reported bad one said. */
function assertAccurate(flat, where) {
  assert.match(flat, /`kosmos connections --how`/, where + ': it does not point at the guide');
  assert.match(flat, /`kosmos connections`/, where + ': the command that lists connected services is not named');
  assert.match(flat, /`kosmos accounts`/, where + ': the command that lists AI providers is not named');
  assert.match(flat, /never read `GET \/api\/connections` yourself/i, where + ': the direct read is not forbidden');
  assert.match(flat, /bill the person/, where + ': the billing warning is missing');
  assert.doesNotMatch(flat, NO_COMMAND, where + ': it says there is no command');
  assert.doesNotMatch(flat, /board token|Authorization:|Bearer /i, where + ': it sends the agent to a read carrying a credential');
}

/* Paraphrased from the block of 2026-09-03 to 09-29 (engine/connections.js at 6a4741fd0b^, lines 114-121), keeping the
   features the report names: no command, a direct read carrying the board token, and no billing warning. */
const OLD_BLOCK = [
  '## How connecting a provider works',
  '',
  'Reading it right is not a one-liner, so lean on the `kosmos` CLI as the',
  'reference rather than hardcoding anything. On a board that enforces auth the read needs',
  'the board token, sent off the command line, never in argv (argv leaks it',
  'cross-account). The CLI resolves the address and sends the token safely;',
  'there is no one-word verb that prints accounts, so it is a direct read of',
  '`GET /api/accounts`.',
].join('\n');

test('kosmos#8868: CONTROL, each check fails on its own bad feature, and the accurate block passes them all', () => {
  /* One control per check: a single assert.throws on the old block stops at the first check that fires, so the
     no-command and credential checks would never be shown to work (review round 1). */
  const good = connections.blockBody().replace(/\s+/g, ' ');
  assertAccurate(good, 'today\'s block');
  const cases = [
    [good.replace('`kosmos connections --how`', '`the guide`'), /it does not point at the guide/],
    [good.replace('`kosmos connections`', '`the connections list`'), /the command that lists connected services is not named/],
    [good.replace('`kosmos accounts`', '`the accounts list`'), /the command that lists AI providers is not named/],
    [good.replace(/never read `GET \/api\/connections` yourself/i, 'read `GET /api/connections`'), /the direct read is not forbidden/],
    [good.replace(/bill the person/, 'cost nothing'), /the billing warning is missing/],
    [good + ' There is no one-word verb that prints accounts.', /it says there is no command/],
    [good + ' There is no kosmos command for this.', /it says there is no command/],
    [good + ' Send the board token with the read.', /it sends the agent to a read carrying a credential/],
  ];
  for (const [text, why] of cases) {
    assert.notEqual(text, good, 'a control case did not change the text: ' + why);
    assert.throws(() => assertAccurate(text, 'control'), why);
  }
  assert.throws(() => assertAccurate(OLD_BLOCK.replace(/\s+/g, ' '), 'old block'), /old block: /);
});

test('kosmos#8868: the section written into an agent file is accurate, and stays so on every regeneration', () => {
  agentFile('steady', '# Steady\n\nYou are Steady.\n');
  const roster = [tied('steady')];
  let first = null;
  for (let i = 0; i < 3; i++) {
    const r = connections.tellAgent('steady', roster);
    assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
    assert.equal(r.changed, i === 0, 'only the first write changes the file; regeneration ' + (i + 1));
    const text = fs.readFileSync(fileOf('steady'), 'utf8');
    assertAccurate(section(text), 'regeneration ' + (i + 1));
    if (first === null) first = text;
    else assert.equal(text, first, 'regeneration ' + (i + 1) + ' wrote a different file');
  }
});

test('kosmos#8868: a file holding the old block is put right by the next write, and the agent\'s own text is kept', () => {
  agentFile('stale', '# Stale\n\nYou are Stale.\n\n' + projects.CONNECTIONS_START + '\n' + OLD_BLOCK + '\n' + projects.CONNECTIONS_END + '\n\nMy own note.\n');
  const r = connections.tellAgent('stale', [tied('stale')]);
  assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
  assert.equal(r.changed, true, 'the old block was left in place');
  const text = fs.readFileSync(fileOf('stale'), 'utf8');
  assertAccurate(section(text), 'after the repair');
  assert.doesNotMatch(text, /one-word verb/, 'the old words survived outside the section');
  assert.match(text, /You are Stale\./);
  assert.match(text, /My own note\./, 'the agent\'s own text after the section was lost');
  assert.equal(text.split(projects.CONNECTIONS_START).length - 1, 1, 'the repair left two sections');
});

/* The on-demand guide must keep the same rules as the block: name both commands, forbid reading either route by hand,
   and keep the billing warning. The credential check is not reused here: the guide rightly says the CLI sends the board
   token off the command line, which is the safe way round. */
function assertGuide(flat, where) {
  assert.match(flat, /To see what is connected, run `kosmos connections`/, where + ': the connections command is not taught');
  assert.match(flat, /Run `kosmos accounts`/, where + ': the accounts command is not taught');
  assert.match(flat, /Do not read the route by hand/, where + ': reading the accounts route by hand is not forbidden');
  assert.match(flat, /Never read `GET \/api\/connections` yourself/, where + ': the direct connections read is not forbidden');
  assert.match(flat, /bill the person for every check/, where + ': the billing warning is missing');
  assert.doesNotMatch(flat, NO_COMMAND, where + ': it says there is no command');
}

test('kosmos#8868: the on-demand guide keeps both commands, both prohibitions and the billing warning, each with a control', () => {
  const flat = connections.guideText().replace(/\s+/g, ' ');
  assertGuide(flat, 'the guide');
  const cases = [
    [flat.replace('To see what is connected, run `kosmos connections`', 'To see what is connected, ask'), /the connections command is not taught/],
    [flat.replace('Run `kosmos accounts`', 'Read the route'), /the accounts command is not taught/],
    [flat.replace('Do not read the route by hand', 'Read the route by hand'), /reading the accounts route by hand is not forbidden/],
    [flat.replace('Never read `GET /api/connections` yourself', 'Read `GET /api/connections`'), /the direct connections read is not forbidden/],
    [flat.replace('bill the person for every check', 'cost nothing'), /the billing warning is missing/],
    [flat + ' There is no one-word verb that prints accounts.', /it says there is no command/],
  ];
  for (const [text, why] of cases) {
    assert.notEqual(text, flat, 'a control case did not change the text: ' + why);
    assert.throws(() => assertGuide(text, 'control'), why);
  }
});

/* Every `spliceBlock(` call in a source, with its whole argument text (it may span lines), found by matching brackets
   and skipping string contents. A heuristic, not a parser: it does not skip comments, regex literals or a nested
   backtick inside `${...}` (each can mis-split a call, which then goes unchecked), and it does not follow a body built
   into a variable first. */
function spliceCalls(src) {
  const calls = [];
  const re = /spliceBlock\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let quote = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const args = src.slice(m.index + m[0].length, i - 1);
    calls.push({ line: src.slice(0, m.index).split('\n').length, args });
  }
  return calls;
}

/* Split top-level arguments (commas outside brackets and strings). */
function topArgs(args) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += args[++i] || ''; } else if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* How a source names the connections module: each alias bound to require('./connections') (any relative spelling,
   with or without .js), plus the inline require itself. */
const CONN_REQUIRE = String.raw`require\(\s*['"](?:\.\.?\/)+(?:engine\/)?connections(?:\.js)?['"]\s*\)`;
function connectionsAliases(src) {
  const out = [];
  const re = new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*` + CONN_REQUIRE, 'g');
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/* The patterns a source uses for the Connections START marker: projects' CONNECTIONS_START (any access), `<alias>.START`,
   the inline `require('./connections').START`, and a bare START that is destructured from the module or bound to the
   marker (connections.js does the latter). */
function connectionsMarkerNames(src) {
  const literal = projects.CONNECTIONS_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [/\bCONNECTIONS_START\b/, new RegExp('^' + CONN_REQUIRE + String.raw`\.START$`), new RegExp('^[\'"`]' + literal + '[\'"`]$')];
  for (const a of connectionsAliases(src)) names.push(new RegExp('^' + a + String.raw`\.START$`));
  /* Destructured from the module, under its own name or renamed: { START } or { START: CONN_START }. */
  const destr = new RegExp(String.raw`(?:const|let|var)\s*\{([^}]*)\}\s*=\s*` + CONN_REQUIRE, 'g');
  let d;
  while ((d = destr.exec(src))) {
    for (const part of d[1].split(',')) {
      const m = part.trim().match(/^START(?:\s*:\s*(\w+))?$/);
      if (m) names.push(new RegExp('^' + (m[1] || 'START') + '$'));
    }
  }
  /* Bound to the marker under any name: const START = projects.CONNECTIONS_START, const CS = pj.CONNECTIONS_START, or
     destructured from projects as { CONNECTIONS_START: X }. */
  const bound = /(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.|require\([^)]*\)\.)?CONNECTIONS_START\b/g;
  let bm;
  while ((bm = bound.exec(src))) names.push(new RegExp('^' + bm[1] + '$'));
  const pdestr = /(?:const|let|var)\s*\{[^}]*\bCONNECTIONS_START\s*:\s*(\w+)[^}]*\}/g;
  let pm;
  while ((pm = pdestr.exec(src))) names.push(new RegExp('^' + pm[1] + '$'));
  return names;
}

/* The body a Connections splice must pass: the connections module's own blockBody(), by alias, inline require, a
   destructured name, or bare inside a file that defines or imports it (connections.js imports it from the guide). */
function connectionsBodyOk(src, body) {
  const forms = [new RegExp('^' + CONN_REQUIRE + String.raw`\.blockBody\(\)$`)];
  for (const a of connectionsAliases(src)) forms.push(new RegExp('^' + a + String.raw`\.blockBody\(\)$`));
  const bareOk = new RegExp(String.raw`(?:const|let|var)\s*\{[^}]*\bblockBody\b[^}]*\}\s*=\s*(?:` + CONN_REQUIRE + String.raw`|require\(\s*['"]\.\/connectionsguide(?:\.js)?['"]\s*\))`).test(src);
  if (bareOk) forms.push(/^blockBody\(\)$/);
  return forms.some((f) => f.test(body));
}

test('kosmos#8868: every writer of the Connections markers writes exactly blockBody(), so no second text exists in this code', () => {
  /* The block is written by connections.tellAgent, by create.js at an agent's birth, and by discover.js for an imported
     agent (review rounds 1 and 2). A writer with words of its own would bring the flip back from current code; this
     fails when one appears. Swept: every .js, .mjs and .cjs file under engine/, bin/, install/ and tools/, and the
     repository's top-level ones. Not seen: a body built into a variable before the call; the module required under a
     path it does not recognise, or brought in with an ESM import; spliceBlock called under another name; a call mis-split by a comment, a regex literal
     or a nested backtick inside it (see spliceCalls). */
  assert.equal(connections.START, projects.CONNECTIONS_START);
  assert.equal(connections.END, projects.CONNECTIONS_END);
  const repo = path.join(__dirname, '..');
  const files = [];
  const walk = (dir, deep) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (deep) walk(full, true); continue; }
      if (/\.(?:js|mjs|cjs)$/.test(e.name) && !/\.test\.(?:js|mjs|cjs)$/.test(e.name)) files.push(full);
    }
  };
  walk(repo, false);
  for (const d of ['engine', 'bin', 'install', 'tools']) if (fs.existsSync(path.join(repo, d))) walk(path.join(repo, d), true);
  // CONTROL: the walk reaches files below engine/ and outside it, so a recursion that silently stopped cannot pass.
  const engineTop = fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js')).length;
  assert.ok(files.length > engineTop, 'the sweep read ' + files.length + ' files, no more than engine/ alone holds (' + engineTop + ')');
  assert.ok(files.some((f) => f.includes(path.sep + 'tools' + path.sep)), 'the sweep did not reach tools/');
  const found = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const names = connectionsMarkerNames(src);
    for (const call of spliceCalls(src)) {
      const args = topArgs(call.args);
      const start = args[2] || '';
      if (!names.some((n) => n.test(start))) continue;
      const where = path.relative(repo, file) + ':' + call.line;
      found.push(where);
      assert.ok(connectionsBodyOk(src, args[1] || ''), where + ' writes the Connections markers with a body other than the connections blockBody(): ' + (args[1] || '(none)'));
    }
  }
  // CONTROL: all three known writers are seen, so a sweep that silently stopped matching cannot pass.
  for (const known of ['engine/connections.js', 'engine/create.js', 'engine/discover.js']) {
    assert.ok(found.some((w) => w.startsWith(known + ':')), 'the sweep did not find the writer in ' + known + ': ' + JSON.stringify(found));
  }
  /* CONTROL: the shapes the sweep must catch, each read as a writer and each refused for its body. */
  const shapes = [
    ["const { START, END, blockBody } = require('./connections');\nprojects.spliceBlock(\n  text,\n  'other ' + blockBody(),\n  START,\n  END\n);", 'a concatenated body over several lines with a destructured START'],
    ["const connMod = require('./connections'); const youMod = require('./you');\nspliceBlock(text, youMod.blockBody(), connMod.START, connMod.END);", 'another module\'s blockBody() on the Connections markers'],
    ["spliceBlock(text, 'other words', require('./connections').START, require('./connections').END);", 'an inline require of the markers'],
    ["spliceBlock(text, 'other words', '<!-- kosmos:connections:start -->', '<!-- kosmos:connections:end -->');", 'the literal marker strings'],
    ["const { START: CONN_START, END: CONN_END } = require('./connections');\nspliceBlock(text, 'other words', CONN_START, CONN_END);", 'a renamed destructured START'],
    ["const pj = require('./projects'); const CS = pj.CONNECTIONS_START;\nspliceBlock(text, 'other words', CS, pj.CONNECTIONS_END);", 'the marker bound to another name'],
  ];
  for (const [src, what] of shapes) {
    const calls = spliceCalls(src);
    assert.equal(calls.length, 1, what);
    const args = topArgs(calls[0].args);
    assert.ok(connectionsMarkerNames(src).some((n) => n.test(args[2])), what + ': not recognised as a Connections writer');
    assert.equal(connectionsBodyOk(src, args[1]), false, what + ': its body was accepted');
  }
  // And the accepted forms really are accepted, so the refusals above are not a check that refuses everything.
  assert.equal(connectionsBodyOk("const connMod = require('./connections');", 'connMod.blockBody()'), true);
  assert.equal(connectionsBodyOk("const { blockBody } = require('./connectionsguide');", 'blockBody()'), true);
});
