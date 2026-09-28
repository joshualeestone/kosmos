'use strict';
require('./test-support/tmpscope');   // #4273: any temp dir this file makes is removed when it exits

/**
 * #4332 (the #4308 rule, applied again on #4323): the Daily report switch's damaged settings file is not a
 * dead end. Behavioural: the page's real paintSwitch and feedbackPaint run against a fake document.
 *   NO ANSWER (a failed fetch, a 403)  the switch is HIDDEN with no position: never a false Off.
 *   DAMAGED FILE (200, {on:false, ok:false})  the board answered and reads it as off, so the switch SHOWS
 *     Off with a line saying the setting could not be read and that turning it on sets it again.
 *   READABLE  a real position and no message (the control).
 * The repair itself (turning it on rewrites a valid file) is the engine's setOn: pinned at the bottom.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function pageFnSource(name) {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  let start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (script.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let stop = -1;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) { stop = k + 1; break; } }
  }
  assert.ok(stop > start, name + ' has no closing brace');
  return script.slice(start, stop);
}

function fakeToggle() {
  const classes = new Set();
  /* Starts PAINTED (visible, Off), so the no-answer arm proves the switch is actively stripped, not merely
     never touched. */
  return {
    hidden: false, attrs: { 'aria-checked': 'false' },
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, remove(c) { classes.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
}

function paint(answer) {
  const els = { 'feedback-toggle': fakeToggle(), 'feedback-msg': { textContent: '' } };
  const document = { getElementById: (id) => els[id] || null };
  const feedbackPaint = new Function('document', pageFnSource('paintSwitch') + '\n' + pageFnSource('feedbackPaint') + '\nreturn feedbackPaint;')(document);
  feedbackPaint(answer);
  const t = els['feedback-toggle'];
  return { hidden: t.hidden, checked: t.getAttribute('aria-checked'), msg: els['feedback-msg'].textContent };
}

test('#4332: a DAMAGED settings file shows the switch Off, says it could not be read, and says how to repair it', () => {
  const s = paint({ on: false, ok: false });
  assert.equal(s.hidden, false, 'the switch is hidden, so the person has no way to repair the file (the dead end)');
  assert.equal(s.checked, 'false');
  assert.match(s.msg, /could not be read/);
  assert.match(s.msg, /Turn it on to set it again/);
});

test('#4332 privacy arm: NO ANSWER (a 403 or a failed fetch) still hides the switch with no position', () => {
  for (const answer of [null, undefined, {}, { error: 'this board belongs to the account that started it' }]) {
    const s = paint(answer);
    assert.equal(s.hidden, true, 'a switch with no answer showed a position: ' + JSON.stringify(answer));
    assert.equal(s.checked, null);
    assert.match(s.msg, /could not check this setting here/);
  }
});

test('#4332: an ok:false answer that is NOT the engine\'s damaged shape is treated as no answer, never a false Off', () => {
  const s = paint({ on: true, ok: false });
  assert.equal(s.hidden, true, 'a switch that may be sending was drawn as a position');
  assert.equal(s.checked, null);
});

test('#4332 control: a readable setting shows its real position and no message', () => {
  for (const on of [true, false]) {
    const s = paint({ on, ok: true });
    assert.equal(s.hidden, false);
    assert.equal(s.checked, String(on));
    assert.equal(s.msg, '');
  }
});

test('#4332: turning it on over a damaged file rewrites a valid file that reads on (the repair)', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fb-4332-'));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: sandbox };
  const script = `
    const fs = require('node:fs'); const path = require('node:path');
    const fb = require(${JSON.stringify(path.join(__dirname, 'engine', 'feedbacksend'))});
    const file = fb.FILE;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"on": tr');
    const before = fb.read();
    const saved = fb.setOn(true);
    const after = fb.read();
    process.stdout.write(JSON.stringify({ before, saved, after, bytes: fs.readFileSync(file, 'utf8') }));`;
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.deepEqual([r.before.on, r.before.ok], [false, false], 'fixture: the file was not unreadable');
  assert.equal(r.saved.ok, true);
  assert.deepEqual([r.after.on, r.after.ok], [true, true], 'turning it on did not repair the file');
  assert.doesNotThrow(() => JSON.parse(r.bytes));
});
