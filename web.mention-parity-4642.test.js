'use strict';
/**
 * #4642: the page paints an @mention blue to say "this post will reach that agent". The engine decides
 * who it really reaches (engine/messages.js mentionedMembers). They are two copies of one rule, so this
 * runs the same fixtures through both and asserts they name the same agents.
 *
 * The fixtures are whitespace-separated tokens. Outside that, the two tokenizers are known to differ in
 * the safe direction (the engine's token stops at a character like an apostrophe, `@mona's`, and flags
 * `mona`; the page leaves it plain), recorded in #2922's review and not changed here.
 *
 *   node --test web.mention-parity-4642.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-mention-parity-4642-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const { mentionedMembers } = require('./engine/messages');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function lift() {
  const start = PAGE.indexOf('function pjMentionHighlightHTML');
  const end = PAGE.indexOf('function pjMentionKeys', start);
  assert.ok(start > 0 && end > start, 'the highlighter and its resolver must sit before pjMentionKeys');
  return new Function(PAGE.slice(start, end) + '; return { pjMentionHighlightHTML, pjMentionResolve };')();
}
const { pjMentionHighlightHTML, pjMentionResolve } = lift();

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* room -> [sessionName, display name] pairs, and how many addressed agents the fixtures must yield */
const ROOMS = {
  plain: [['mona', 'Mona'], ['kano', 'Kano'], ['subzero', 'Sub-Zero'], ['renet-tilley', 'Renet Tilley']],
  twins: [['sub-zero', 'Sub-Zero'], ['subzero', 'Frost'], ['kano', 'K']],
};
const FLOOR = { plain: 15, twins: 6 };
const FIXTURES = [
  'hi @mona', '@Mona', '@MONA.', 'cc @mona-', '@mona_bar', '@Kano please', '@KANO!', '(@kano)', '**@Kano**',
  '@Sub-Zero', '@sub_zero', '@SUBZERO.', '@SubZero-', '@subzerox', '@kanobot', 'kano and Sub-Zero',
  'admin@kano', '_@mona_', '@RenetTilley', '@renet-tilley', '@Renet', '@k', '@K.', '@Frost', '@sub-zero',
  '@Somebody', '@mona and @Sub-Zero and @kano', '@.', '@-',
];

for (const [room, pairs] of Object.entries(ROOMS)) {
  test(`#4642 parity (${room} room): the page paints blue exactly the agents the engine addresses`, () => {
    const keys = new Map(pairs);
    const roster = pairs.map(([sessionName, name]) => ({ sessionName, name }));
    const recipients = pairs.map(([k]) => k);
    let named = 0;
    for (const text of FIXTURES) {
      const engine = [...mentionedMembers(text, recipients, roster)].sort();
      const page = [...pjMentionHighlightHTML(text, keys).matchAll(/<span class="pj-live-mention">@([^<]*)<\/span>/g)]
        .map((m) => pjMentionResolve(m[1], keys).key).sort();
      assert.deepEqual([...new Set(page)], engine, `page and engine disagree on ${JSON.stringify(text)}`);
      named += engine.length;
    }
    // non-vacuous: the fixtures really do name agents in this room, not just agree on "nobody"
    assert.ok(named >= FLOOR[room], `only ${named} addressed across the fixtures; the comparison is too thin`);
  });
}
