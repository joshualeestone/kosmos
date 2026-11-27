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
const lineOf = (text) => text.split('\n').find((l) => l.includes('(cut here'));

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
  assert.equal(line, '    (cut here: kosmos community read --post ' + ID + ' shows it whole)');
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
  assert.equal(lineOf(cr.frame([it], '')), '    (cut here: its thread is kosmos community read --post ' + ID + ')');
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
  const title = 'Mr. Smith ' + 'goes to town and writes about it at length '.repeat(5);
  const it = cr.itemOf(post({ title, body: SENTENCE.repeat(60) }));
  assert.ok(it.title.length >= cr.TITLE_CAP * 0.75, 'the title was cut back to almost nothing: ' + JSON.stringify(it.title));
  assert.ok(it.title.startsWith('Mr. Smith goes to town') && it.title.endsWith(' [cut]'));
  const last = it.title.replace(/ \[cut\]$/, '').split(' ').pop();
  assert.ok(['goes', 'to', 'town', 'and', 'writes', 'about', 'it', 'at', 'length'].includes(last), 'cut mid-word: ' + JSON.stringify(it.title.slice(-20)));
  const name = cr.itemOf(post({ agent: { name: 'Dr. ' + 'Abcdefgh '.repeat(12) } })).author;
  assert.ok(name.length > 40, 'a long name was cut back to its first sentence: ' + JSON.stringify(name));
  // CONTROL: a field that starts with a sentence end is not cut to nothing.
  const dot = cr.itemOf(post({ title: '. ' + 'x'.repeat(300) }));
  assert.ok(dot.title.length > 100, 'a title starting ". " was cut to nothing: ' + JSON.stringify(dot.title));
});

test('#9172 review 2: on a computer whose company has its own community, the line for a public post carries --public', () => {
  const it = cr.itemOf(post({ body: SENTENCE.repeat(60) }));
  assert.equal(lineOf(cr.frame([it], '', null, false, ' --public')), '    (cut here: kosmos community read --post ' + ID + ' --public shows it whole)');
  const reply = cr.itemOf(post({ body: SENTENCE.repeat(60), commentId: CID }));
  assert.equal(lineOf(cr.frame([reply], '', null, false, ' --public')), '    (cut here: its thread is kosmos community read --post ' + ID + ' --public)');
  // CONTROL: any other flag value is not printed (only the board's own two values reach the line).
  assert.equal(lineOf(cr.frame([it], '', null, false, ' --older x')), '    (cut here: kosmos community read --post ' + ID + ' shows it whole)');
  // And both feeds pass their own rule: the plain read the same one its footer's next page uses, Following home's.
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('./communityread'), 'utf8');
  assert.match(src, /frame\(items, heading, null, company, opts\.public && scope\.company \? ' --public' : ''\)/);
  const fsrc = fs.readFileSync(require.resolve('./communityfollow'), 'utf8');
  assert.match(fsrc, /communityread\.frame\(shown, [^\n]*, null, false, readFlagOf\(\)\)/);
});
