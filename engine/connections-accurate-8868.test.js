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

/* "There is no command" in the spellings seen and the near rewordings ("no kosmos command", "no verb for this"). */
const NO_COMMAND = /one-word verb|no such command|\bno (?:\w+ ){0,2}(?:command|verb)\b|there is no (?:command|kosmos|verb)/i;

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

/* Paraphrased from the block of 2026-09-03 to 09-29 (engine/connections.js at 6a4741fd0b^, lines 116-121), keeping the
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
    [good.replace(/`kosmos connections`(?! --how)/, '`the connections list`'), /the command that lists connected services is not named/],
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

test('kosmos#8868: the on-demand guide keeps the billing warning and never says there is no command', () => {
  const flat = connections.guideText().replace(/\s+/g, ' ');
  assert.match(flat, /To see what is connected, run `kosmos connections`/);
  assert.match(flat, /bill the person for every check/);
  assert.doesNotMatch(flat, NO_COMMAND);
});

/* Every `spliceBlock(` call in a source, with its whole argument text (it may span lines), found by matching brackets
   and skipping string contents. A heuristic, not a parser: it does not follow a body built into a variable first. */
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

/* The names a source uses for the Connections START marker: projects' CONNECTIONS_START (any spelling of access),
   `<alias>.START` for each alias bound to require('./connections'), and a bare START that is destructured from it
   or (in connections.js) bound to the marker. */
function connectionsMarkerNames(src, file) {
  const names = [/\bCONNECTIONS_START\b/];
  const aliasRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:\.\/|\.\.?\/engine\/|\.\/engine\/)connections['"]\s*\)/g;
  let m;
  while ((m = aliasRe.exec(src))) names.push(new RegExp('\\b' + m[1] + '\\.START\\b'));
  if (/(?:const|let|var)\s*\{[^}]*\bSTART\b[^}]*\}\s*=\s*require\(\s*['"][^'"]*connections['"]\s*\)/.test(src)) names.push(/^START$/);
  if (/(?:const|let|var)\s+START\s*=\s*(?:\w+\.)?CONNECTIONS_START\b/.test(src)) names.push(/^START$/);
  return names;
}

test('kosmos#8868: every writer of the Connections markers writes exactly blockBody(), so no second text exists in this code', () => {
  /* The block is written by connections.tellAgent, by create.js at an agent's birth, and by discover.js for an imported
     agent (review rounds 1 and 2). A writer with words of its own would bring the flip back from current code; this
     fails when one appears. Swept: engine/ and the repository's top-level .js files. Not seen: a body built into a
     variable before the call, and code that requires the module under another path. */
  assert.equal(connections.START, projects.CONNECTIONS_START);
  assert.equal(connections.END, projects.CONNECTIONS_END);
  const roots = [__dirname, path.join(__dirname, '..')];
  const found = [];
  for (const dir of roots) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js') || f.endsWith('.test.js') || f === 'projects.js') continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const names = connectionsMarkerNames(src, f);
      for (const call of spliceCalls(src)) {
        const args = topArgs(call.args);
        const start = args[2] || '';
        if (!names.some((n) => n.test(start))) continue;
        const where = path.relative(path.join(__dirname, '..'), path.join(dir, f)) + ':' + call.line;
        found.push(where);
        assert.match(args[1] || '', /^(?:\w+\.)?blockBody\(\)$/, where + ' writes the Connections markers with a body other than blockBody(): ' + (args[1] || '(none)'));
      }
    }
  }
  // CONTROL: all three known writers are seen, so a sweep that silently stopped matching cannot pass.
  for (const known of ['engine/connections.js', 'engine/create.js', 'engine/discover.js']) {
    assert.ok(found.some((w) => w.startsWith(known + ':')), 'the sweep did not find the writer in ' + known + ': ' + JSON.stringify(found));
  }
  // CONTROL: the sweep reads a call spread over lines, a destructured START, and refuses a concatenated body.
  const multi = "const { START, END } = require('./connections');\nprojects.spliceBlock(\n  text,\n  'other ' + blockBody(),\n  START,\n  END\n);";
  const mc = spliceCalls(multi);
  assert.equal(mc.length, 1);
  const ma = topArgs(mc[0].args);
  assert.ok(connectionsMarkerNames(multi, 'x.js').some((n) => n.test(ma[2])), 'a destructured START was not recognised');
  assert.doesNotMatch(ma[1], /^(?:\w+\.)?blockBody\(\)$/, 'a concatenated body was accepted');
});
