'use strict';
/**
 * #3013: the board card and list row for a Windows agent stuck at Claude Code's
 * invisible workspace-trust prompt. A DOM-level test (it extracts the SHIPPED
 * card()/lrow() from web/index.html and renders them), so it runs on macOS CI
 * where the win32 browser-check arm skips. It proves the offline early-return
 * draws the distinct trust treatment -- the diagnosis instead of "Not running".
 *
 *   node --test web.trust-wait-card-3013.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/* The state label, read from the page's own STATE_COPY.needs_trust entry so the
   test pins the SHIPPED copy rather than a second hand-typed one. (liftConst is
   not used: STATE_COPY's block comments carry semicolons, which its `[^;]+`
   extractor truncates on -- a limitation of that helper, not of this state.) */
function pageLabel() {
  const m = /needs_trust:\s*\{\s*label:\s*'([^']+)'/.exec(SCRIPT);
  assert.ok(m, 'STATE_COPY.needs_trust.label is gone from the page; this test is stale, not the code');
  return m[1];
}

/* The shipped renderers, with the helpers they reach for. face and dmBadge are
   lifted like web.not-running does; STATE_COPY is injected (built from the page's
   own label above), the rest are stubbed. */
function render(which, a) {
  const body = page.lift(SCRIPT, 'face') + '\n'
    + page.lift(SCRIPT, 'dmBadge') + '\n'
    + page.lift(SCRIPT, which) + '\n'
    + `return ${which}(a);`;
  const fn = new Function('a', 'esc', 'roleLine', 'discTint', 'discInk', 'initials', 'ROLE_TITLES', 'CURRENT', 'STATE_COPY', 'GLYPH', body);
  return fn(a, (x) => String(x == null ? '' : x), (x) => x.role || '', () => '#eee', () => '#111', (n) => n[0], null, null,
    { needs_trust: { label: pageLabel() }, unknown: { label: "Can't tell" } },
    { stopped: '<span class="stop"></span>', unknown: '<span class="qmark">?</span>' });
}

const BECAUSE = 'it started but never registered -- its folder is not recorded as trusted in the config it runs under, so it is waiting at a workspace-trust prompt no one can see';
function trustAgent(extra) {
  return Object.assign({
    sessionName: 'winny', name: 'Winny', running: false, state: 'needs_trust',
    needsTrust: true, role: 'Researcher', hasAvatar: false, because: BECAUSE,
  }, extra || {});
}
/* A plain offline agent (the control): same not-running shape, no trust marker. */
function offlineAgent() {
  return {
    sessionName: 'ghosty', name: 'Ghosty', running: false, state: 'stopped',
    needsTrust: false, role: 'Copywriter', hasAvatar: false, jobRunningUnseen: false,
    because: 'this agent is not running: nothing on this computer has a session for it',
  };
}

for (const which of ['card', 'lrow']) {
  test(`${which}: a needsTrust agent draws the workspace-trust treatment, not "Not running"`, () => {
    const html = render(which, trustAgent());
    assert.match(html, /needstrust/, `${which} did not draw the trust marker class`);
    assert.match(html, /Winny/);
    assert.match(html, /Waiting on a trust prompt/, `${which} did not carry the trust state label`);
    assert.doesNotMatch(html, /Not running/, `${which} still drew the misleading "Not running" copy for a stuck agent`);
    /* attn treatment: a person has to answer the prompt no window shows. */
    assert.match(html, /\battn\b/, `${which} is not dressed as an attention state`);
  });

  test(`${which}: the trust pill wears a class the stylesheet actually dresses`, () => {
    const html = render(which, trustAgent());
    const cls = /class="(?:astate|lstate) (st-[a-z-]+)"/.exec(html);
    assert.ok(cls, `${which} put no state class on the trust pill`);
    const rules = PAGE.split(`.${cls[1]}`).length - 1;
    assert.ok(rules > 0, `${which} uses .${cls[1]}, which has no rule in the stylesheet`);
  });

  test(`${which}: a plain offline agent is unchanged -- still "Not running", no trust marker`, () => {
    const html = render(which, offlineAgent());
    assert.match(html, /Not running/);
    assert.doesNotMatch(html, /needstrust/, `${which} drew the trust treatment for an ordinary stopped agent`);
    assert.match(html, /Ghosty/);
  });
}

test('card: the guidance because rides the card as a note', () => {
  const html = render('card', trustAgent());
  assert.match(html, /class="note"/, 'the card carries no note for the trust guidance');
  assert.match(html, /workspace-trust prompt no one can see/, 'the card note does not carry the supervisor reason');
});

test('card: a needsTrust agent with no because falls back to a self-contained sentence', () => {
  const html = render('card', trustAgent({ because: undefined }));
  assert.match(html, /waiting at a workspace-trust prompt no one can see/,
    'the card must still explain the state when the server sent no because');
});

test('lrow: the trust row keeps the seven-column grid (no cell shifts right)', () => {
  const html = render('lrow', trustAgent());
  for (const slot of ['lav', 'lname', 'ltitle', 'lstate', 'ltask', 'lmodel', 'lmem']) {
    assert.ok(html.includes(`class="${slot}"`) || html.includes(`class="${slot} `),
      `the trust list row is missing its ${slot} cell, so every cell after it moves one column`);
  }
});

test('both renderers name the SAME trust label (one source: STATE_COPY.needs_trust)', () => {
  /* The card and the row must not drift on the state word. Both read
     STATE_COPY.needs_trust.label, so the label appears in both. */
  assert.match(render('card', trustAgent()), /Waiting on a trust prompt/);
  assert.match(render('lrow', trustAgent()), /Waiting on a trust prompt/);
});

test('the page ships the expected trust label copy', () => {
  assert.equal(pageLabel(), 'Waiting on a trust prompt',
    'the shipped STATE_COPY.needs_trust label changed; update this pin deliberately');
});
