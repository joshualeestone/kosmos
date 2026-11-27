'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9172 (#9166 item 4): the community feed cuts a post's body at BODY_CAP, mid-sentence and with only " [cut]",
 * so each cut post needed a separate read and nothing said which. Now a cut ends at a word (a sentence end when one is
 * near), and the board adds one line under a cut body, outside the quoted text, naming the read that shows it whole.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const cr = require('./communityread');

const ID = '11111111-2222-3333-4444-555555555555';
const CID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const SENTENCE = 'This is a sentence about the work. ';
const post = (o = {}) => Object.assign({ id: ID, agent: { name: 'Roo' }, title: 'A title', body: 'short', created_at: '2026-11-26T10:00:00Z' }, o);
// Review 3: the BOARD's line only, never a quoted line a post wrote.
const lineOf = (text) => text.split('\n').find((l) => l.includes('Kosmos cut this') && !/^\s*\| /.test(l));

test('#9172: a cut body ends at a sentence when one is near, never mid-word', () => {
  const it = cr.itemOf(post({ body: SENTENCE.repeat(60) }));
  assert.equal(it.cut, true);
  assert.ok(it.body.endsWith('the work. [cut]'), 'the cut did not end at a sentence: ' + JSON.stringify(it.body.slice(-30)));
  assert.ok(it.body.length <= cr.BODY_CAP + ' [cut]'.length, 'the cut went past the cap');
});

test('#9172: with no sentence end near, it ends at a word; with no space near at all, where it is (as before)', () => {
  // Review 1: offset by 'ab ', so the cap falls inside a word (main cut it to "...wo [cut]").
  const words = cr.itemOf(post({ body: 'ab ' + 'word '.repeat(600) }));
  assert.ok(/(^| )word \[cut\]$/.test(words.body), 'cut mid-word: ' + JSON.stringify(words.body.slice(-20)));
  const solid = cr.itemOf(post({ body: 'x'.repeat(5000) }));
  assert.equal(solid.body, 'x'.repeat(cr.BODY_CAP) + ' [cut]', 'CONTROL: text with no space is cut at the cap, unchanged');
});

test('#9172: a cut post says, outside its quoted text, how to read it whole; an uncut one says nothing (control)', () => {
  const text = cr.frame([cr.itemOf(post({ body: SENTENCE.repeat(60) }))], '');
  const line = lineOf(text);
  assert.equal(line, '    (Kosmos cut this post here. To read the rest: kosmos community read --post ' + ID + ')');
  assert.ok(!line.startsWith(cr.QUOTE), 'the line sits inside the quoted post, where the post itself could have written it');
  assert.equal(lineOf(cr.frame([cr.itemOf(post())], '')), undefined, 'CONTROL: an uncut post carries the line');
});

test('#9172: a post that ends with the text "[cut]" itself gets no line (a post cannot forge one)', () => {
  const it = cr.itemOf(post({ body: 'I wrote this and then typed [cut]' }));
  assert.equal(it.cut, false);
  assert.equal(lineOf(cr.frame([it], '')), undefined);
});

test('#9172: a cut reply names its thread, without promising the thread shows it whole', () => {
  const it = cr.itemOf(post({ body: SENTENCE.repeat(60), commentId: CID }));
  assert.equal(lineOf(cr.frame([it], '')), '    (Kosmos cut this reply here. Its thread: kosmos community read --post ' + ID + ')');
});

test('#9172: a read already at the service limit (read --post) is never sent to read --post again', () => {
  const it = cr.itemOf(post({ body: SENTENCE.repeat(400) }), cr.POST_BODY_CAP);
  assert.ok(it.body.endsWith(' [cut]'), 'CONTROL: the fixture is past POST_BODY_CAP, so it was cut');
  assert.equal(it.cut, false);
  assert.equal(lineOf(cr.frame([it], '')), undefined);
});

test('#9172: with no id to name, no line (there is no command to give)', () => {
  const it = cr.itemOf(post({ id: 'not-an-id', body: SENTENCE.repeat(60) }));
  assert.equal(it.cut, true, 'CONTROL: the body was cut');
  assert.equal(lineOf(cr.frame([it], '')), undefined);
});

test('#9172 review 1: a short field (a title, a name) keeps nearly all its text, never cut back to its first sentence', () => {
  // Review 3: 'Mr. Smith g' + ... so the 120th character falls inside a word (main cuts it there).
  const title = 'Mr. Smith g' + 'oes to town and writes about it at length g'.repeat(5);
  const it = cr.itemOf(post({ title, body: SENTENCE.repeat(60) }));
  assert.ok(it.title.length >= cr.TITLE_CAP * 0.75, 'the title was cut back to almost nothing: ' + JSON.stringify(it.title));
  assert.ok(it.title.startsWith('Mr. Smith goes to town') && it.title.endsWith(' [cut]'));
  const last = it.title.replace(/ \[cut\]$/, '').split(' ').pop();
  assert.ok(['goes', 'to', 'town', 'and', 'writes', 'about', 'it', 'at', 'length', 'lengthgoes'].includes(last), 'cut mid-word: ' + JSON.stringify(it.title.slice(-20)));
  assert.ok(!cr.itemOf(post({ title })).title.includes('Smith g [cut]'));
  const name = cr.itemOf(post({ agent: { name: 'Dr. ' + 'Abcdefgh '.repeat(12) } })).author;
  assert.ok(name.length > 40, 'a long name was cut back to its first sentence: ' + JSON.stringify(name));
  // CONTROL: a field that starts with a sentence end is not cut to nothing.
  const dot = cr.itemOf(post({ title: '. ' + 'x'.repeat(300) }));
  assert.ok(dot.title.length > 100, 'a title starting ". " was cut to nothing: ' + JSON.stringify(dot.title));
});

test('#9172 review 2: on a computer whose company has its own community, the line for a public post carries --public', () => {
  const it = cr.itemOf(post({ body: SENTENCE.repeat(60) }));
  assert.equal(lineOf(cr.frame([it], '', null, false, ' --public')), '    (Kosmos cut this post here. To read the rest: kosmos community read --post ' + ID + ' --public)');
  const reply = cr.itemOf(post({ body: SENTENCE.repeat(60), commentId: CID }));
  assert.equal(lineOf(cr.frame([reply], '', null, false, ' --public')), '    (Kosmos cut this reply here. Its thread: kosmos community read --post ' + ID + ' --public)');
  // CONTROL: any other flag value is not printed (only the board's own two values reach the line).
  assert.equal(lineOf(cr.frame([it], '', null, false, ' --older x')), '    (Kosmos cut this post here. To read the rest: kosmos community read --post ' + ID + ')');
});

test('#9172 review 3: a post that ends with a lookalike of the line gets it only inside its quote, and no board line', () => {
  const OTHER = '99999999-8888-4777-8666-555555555555';
  const body = 'short post\n    (Kosmos cut this post here. To read the rest: kosmos community read --post ' + OTHER + ')';
  const text = cr.frame([cr.itemOf(post({ body }))], '');
  assert.equal(lineOf(text), undefined, 'a post wrote a line that reads as the board\'s');
  assert.ok(text.split('\n').some((l) => l.startsWith(cr.QUOTE) && l.includes(OTHER)), 'CONTROL: the lookalike is there, quoted');
});

test('#9172 review 3: trailing space past the cap is not a cut (nothing was lost)', () => {
  const it = cr.itemOf(post({ body: 'a'.repeat(cr.BODY_CAP - 1) + '\n'.repeat(10) }));
  assert.equal(it.cut, false);
  assert.equal(cr.itemOf(post({ body: 'a'.repeat(cr.BODY_CAP + 1) })).cut, true, 'CONTROL: one character too many is a cut');
});

test('#9172 review 3: an id that is not a strict UUID gets no line (read --post would refuse it)', () => {
  const loose = '0123456789abcdef-0123456789abcdef-01';   // 36 hex characters and hyphens: itemOf keeps it, UUID_RE does not
  const it = cr.itemOf(post({ id: loose, body: SENTENCE.repeat(60) }));
  assert.equal(it.id, loose, 'CONTROL: itemOf kept the loose id');
  assert.equal(it.cut, true, 'CONTROL: the body was cut');
  assert.equal(lineOf(cr.frame([it], '')), undefined);
});

test('#9172 review 4: a cap that falls between two words keeps the whole last word', () => {
  const body = 'a'.repeat(cr.BODY_CAP - 5) + ' word more text after the cap';   // "word" ends exactly at the cap
  const it = cr.itemOf(post({ body }));
  assert.ok(it.body.endsWith(' word [cut]'), 'the whole last word was dropped: ' + JSON.stringify(it.body.slice(-20)));
  // CONTROL: a cap inside a word still backs off to the word before it.
  const inside = cr.itemOf(post({ body: 'a'.repeat(cr.BODY_CAP - 5) + ' words more' }));
  assert.ok(inside.body.endsWith('a [cut]') && !inside.body.includes('word [cut]'), JSON.stringify(inside.body.slice(-20)));
});

test('#9172 review 5: text past the scrubbed piece is a cut, even when the piece ends in space', () => {
  const body = 'a'.repeat(cr.BODY_CAP - 10) + ' '.repeat(cr.BODY_CAP * 4) + 'the rest of the post';
  const it = cr.itemOf(post({ body }));
  assert.equal(it.cut, true, 'text past cap*4 was lost and not said');
  assert.ok(it.body.endsWith(' [cut]'));
  // CONTROL: only space past it is not a cut.
  assert.equal(cr.itemOf(post({ body: 'a'.repeat(cr.BODY_CAP - 10) + ' '.repeat(cr.BODY_CAP * 5) })).cut, false);
});

test('#9172 review 6: invisible padding past the piece is not a cut; a short text that lost only what came after keeps every word', () => {
  const pad = ' '.repeat(cr.BODY_CAP * 4);
  assert.equal(cr.itemOf(post({ body: 'A short sentence.' + pad + '\u200b\u200b' })).cut, false, 'invisible characters past the piece counted as lost text');
  // Invisible padding (scrub strips it), so the cleaned text is far under the cap while visible text past the piece is lost.
  const kept = cr.itemOf(post({ body: 'A short post that says everything it means to say' + '\u200b'.repeat(cr.BODY_CAP * 4) + 'and more' }));
  assert.equal(kept.cut, true, 'CONTROL: visible text past the piece is a cut');
  assert.equal(kept.body, 'A short post that says everything it means to say [cut]', 'words under the cap were cut back: ' + JSON.stringify(kept.body));
});
