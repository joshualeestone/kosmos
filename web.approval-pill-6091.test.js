'use strict';

/**
 * #6091 (follow-up to #6054): while a Claude agent waits on its permission prompt, its status pill read "Issue", which
 * reads as broken. It now reads "Waiting for you".
 *
 * The signal is the card's `awaitingApproval` (engine/status.js awaitingApprovalOf), read from the SCREEN before the
 * agent's own report is reconciled in. Review 1 found why `because` could not carry it: the PermissionRequest hook
 * reports the same moment as needs_you by 'auto' with its own words, and reconcileReport then keeps those words, so the
 * screen's "it is waiting for your approval" never reached the card. The engine test below runs that exact path.
 *
 * Still an attention state with the needs-you card look: the prompt blocks the agent until someone answers it, and
 * #2808 keeps a technical prompt red on purpose, as the fallback when nothing answers it. Only the word changes.
 *
 *   node --test web.approval-pill-6091.test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-6091-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./engine/status');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCREEN = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const ASKING = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');
// A native Claude pane (its command is the version), so classify takes the Claude path.
const PANE = { command: '2.1.296', title: '✳ x', session: 'x', name: 'x' };

function constBlock(name) {
  const at = PAGE.indexOf('const ' + name + ' = {');
  assert.notEqual(at, -1, name + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n};', at) + 3);
}
function oneLiner(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n', at));
}
function multiLine(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}

const derive = new Function(`
  ${constBlock('CARD_ST')}
  ${constBlock('STATE_COPY')}
  function restartingLabel() { return 'Restarting agent'; }
  ${oneLiner('function cardStOf(a)')}
  ${multiLine('function stateCopyOf(a)')}
  return { cardStOf, stateCopyOf };
`)();

const card = (over) => Object.assign({ state: 'needs_you', stateReportedBy: 'auto', awaitingApproval: true }, over);
// What the PermissionRequest hook writes (engine/kosmos-report-hook.js), as selfreport.read returns it.
const hookReport = (nowMs) => ({ found: true, state: 'needs_you', because: 'asking permission to use Bash: ls -la', by: 'auto', at: new Date(nowMs - 2000).toISOString(), project: null });

test('#6091 engine: the real permission-prompt screen, with the hook\'s report reconciled in, sets awaitingApproval', () => {
  const now = Date.now();
  const scraped = status.classify(PANE, SCREEN);
  assert.equal(scraped.state, 'needs_you', 'CONTROL: the capture reads needs_you');
  assert.equal(scraped.because, status.APPROVAL_WAITING, 'CONTROL: the capture is read as a permission prompt');
  const reconciled = status.reconcileReport(hookReport(now), scraped, now);
  assert.equal(reconciled.state, 'needs_you');
  assert.notEqual(reconciled.because, status.APPROVAL_WAITING, 'CONTROL: the report\'s words replace the screen\'s (review 1\'s finding), so `because` could not carry it');
  assert.equal(status.awaitingApprovalOf(scraped, reconciled), true);
});

test('#6091 engine: with no report at all (hook not wired), awaitingApproval is set too', () => {
  const now = Date.now();
  const scraped = status.classify(PANE, SCREEN);
  assert.equal(status.awaitingApprovalOf(scraped, status.reconcileReport({ found: false }, scraped, now)), true);
});

test('#6091 engine control: another question on screen is not a permission prompt', () => {
  const now = Date.now();
  const scraped = status.classify(PANE, ASKING);
  assert.equal(scraped.state, 'needs_you', 'CONTROL: the question menu reads needs_you');
  assert.equal(status.awaitingApprovalOf(scraped, status.reconcileReport(hookReport(now), scraped, now)), false);
});

test('#6091 engine control: only while the reconciled card is still needs_you', () => {
  const scraped = status.classify(PANE, SCREEN);
  assert.equal(status.awaitingApprovalOf(scraped, { state: 'working' }), false);
  assert.equal(status.awaitingApprovalOf(scraped, { state: 'stopped' }), false);
  assert.equal(status.awaitingApprovalOf(null, { state: 'needs_you' }), false);
});

test('#6091 engine: both card builders carry the field (the pane card from the screen, the paneless card as false)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'engine', 'status.js'), 'utf8');
  assert.ok(SRC.includes('awaitingApproval: awaitingApprovalOf(scrapedStatus, status),'), 'the pane card no longer sets it from its screen');
  assert.ok(SRC.includes('awaitingApproval: false,'), 'the paneless card no longer carries it');
  const PROJ = fs.readFileSync(path.join(__dirname, 'engine', 'projects.js'), 'utf8');
  assert.ok(PROJ.includes('awaitingApproval: Boolean(card && card.isNamedOurs && card.awaitingApproval === true)'), 'project members no longer carry it');
});

test('#6091 page: an agent on its permission prompt reads "Waiting for you", not "Issue"', () => {
  const copy = derive.stateCopyOf(card());
  assert.equal(copy.label, 'Waiting for you');
  assert.notEqual(copy.label, 'Issue');
});

test('#6091 page: it stays an attention state with the needs-you card look (only the word changes)', () => {
  assert.equal(derive.stateCopyOf(card()).attn, true, 'it blocks the agent until someone answers');
  assert.equal(derive.cardStOf(card()).st, 'attn', '#2808 keeps a technical prompt on the needs-you look');
});

test('#6091 page control: any other needs_you is still "Issue"', () => {
  assert.equal(derive.stateCopyOf(card({ awaitingApproval: false })).label, 'Issue');
  assert.equal(derive.stateCopyOf(card({ awaitingApproval: undefined })).label, 'Issue', 'a card without the field');
  assert.equal(derive.stateCopyOf(card({ awaitingApproval: 'true' })).label, 'Issue', 'only the boolean true');
});

test('#6091 page control: the field alone does not relabel a state that is not needs_you', () => {
  assert.equal(derive.stateCopyOf(card({ state: 'working' })).label, 'Working');
  assert.equal(derive.stateCopyOf(card({ state: 'idle' })).label, 'Idle');
});

test('#6091 page: an agent\'s own deliberate question still reads "Question" (#2808 comes first)', () => {
  assert.equal(derive.stateCopyOf(card({ stateReportedBy: 'agent' })).label, 'Question');
});

test('#6091 page: the other-account rows go through stateCopyOf, so they say the same', () => {
  assert.ok(/typeof stateCopyOf === 'function' \? stateCopyOf\(a\) : STATE_COPY\[a\.state\]/.test(PAGE), 'the oa-sub label reads STATE_COPY directly again');
});

test('#6091: engine/cardlabel.js (an agent\'s own `kosmos report show`) says the same', () => {
  const { labelOf } = require('./engine/cardlabel');
  assert.equal(labelOf(card()), 'Waiting for you');
  assert.equal(labelOf(card({ awaitingApproval: false })), 'Issue');
});
