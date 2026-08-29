'use strict';
/**
 * A link is a link everywhere a person's message is drawn (#355).
 *
 * `pjInline` was written for the project room and was correct: a pasted URL
 * became a real link with trailing punctuation excluded. The other three rows
 * kept `esc(text)`, so the same paste was a link in one box and dead
 * characters in the next box along. Nobody chose that. These run the real
 * renderers, lifted from the page, and check two things at each site: a URL
 * is an anchor, and markup is still escaped, because linking must not become
 * a way in for HTML.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

// Sandbox before the fixture is required: it writes a real worker instruction file.
const os = require('node:os');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-links-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const fleet = require('./test-support/fleet');
const { codeOnly } = require('./test-support/code-only');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
/* The card the renderers read CURRENT from: a real one from the real reader
   (house rule), reduced to the two fields they use. */
const DANA = (() => {
  const board = fleet.install([fleet.agent('dana', { displayName: 'Dana', state: 'idle' })]);
  try { const { sessionName, name } = board.agents[0]; return { sessionName, name }; } finally { board.restore(); }
})();
const lift = (names) => names.map((n) => page.lift(SCRIPT, n)).join('\n');

const TEXT = 'see https://example.test/page. and <b>not bold</b>';
const expectLinked = (html, where) => {
  assert.match(html, /<a class="xlink" href="https:\/\/example\.test\/page" target="_blank" rel="noreferrer noopener">https:\/\/example\.test\/page<\/a>\./,
    where + ': the URL is not a link, or the trailing full stop was swallowed into it');
  assert.doesNotMatch(html, /<b>not bold<\/b>/, where + ': markup reached the page unescaped');
  assert.match(html, /&lt;b&gt;not bold&lt;\/b&gt;/, where + ': the markup was dropped rather than escaped');
};

test('pjInline links a URL and escapes everything else', () => {
  const fn = new Function(lift(['esc', 'pjInline']) + '\nreturn pjInline;')();
  expectLinked(fn(TEXT), 'pjInline');
  assert.equal(fn('no links here <i>x</i>'), 'no links here &lt;i&gt;x&lt;/i&gt;', 'a message with no URL changed');
});


test('direct messages link a URL (dmRow), both directions', () => {
  const fn = new Function('CURRENT', lift(['asSentence', 'esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow theirs');
  expectLinked(fn({ from: 'you', you: true, text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow mine');
});

test('a project message row links a URL (pjMsg)', () => {
  const src = lift(['asSentence', 'esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'pjMsg']);
  const fn = new Function('document', 'pjAnnounce', src + '\nreturn pjMsg;')({ getElementById: () => null }, () => {});
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'pjMsg');
});

test('no render site escapes a message text directly any more', () => {
  // The regression this card is about: a fifth row added with esc(text) would
  // be dead text again. Every row that draws a person's or agent's message
  // text goes through pjInline.
  for (const fn of ['dmRow', 'pjMsg', 'pjRoomRow']) {
    const body = page.lift(SCRIPT, fn);
    assert.doesNotMatch(body, /esc\((r|m)\.text\)/, fn + ' draws message text with esc() instead of pjInline()');
  }
});

/* ---- the link preview card (#357), page half --------------------------- */
test('a preview card renders from the engine shape, escaped, and refuses what it must', () => {
  const fn = new Function(lift(['esc', 'pjPreviewCard']) + '\nreturn pjPreviewCard;')();
  const full = fn({ url: 'https://example.test/p.', title: 'A <b>page</b>', description: 'Two <i>lines</i>', image: '/api/preview-image/abc', site: 'example.test' });
  assert.match(full, /^<a class="lpv" href="https:\/\/example\.test\/p\." target="_blank" rel="noreferrer noopener">/);
  assert.match(full, /<img src="\/api\/preview-image\/abc" alt="" loading="lazy">/);
  assert.match(full, /lpv-title">A &lt;b&gt;page&lt;\/b&gt;</, 'the title reached the page unescaped or was dropped');
  assert.match(full, /lpv-desc">Two &lt;i&gt;lines&lt;\/i&gt;</);
  assert.match(full, /lpv-site">example\.test</);
  // Text-only card, host derived from the URL when the engine gave none.
  const text = fn({ url: 'https://docs.example.test/a/b', title: 'Docs' });
  assert.match(text, /lpv-site">docs\.example\.test</);
  assert.doesNotMatch(text, /lpv-img/);
  // Absence is absence: no preview, no tags, a non-http URL, all render nothing.
  for (const bad of [undefined, null, 'x', {}, { url: 'https://x.test' }, { url: 'javascript:alert(1)', title: 't' }, { url: 'ftp://x.test/f', title: 't' }]) {
    assert.equal(fn(bad), '', 'rendered a card for ' + JSON.stringify(bad));
  }
  // The image is board-served or nothing: a remote image would make the
  // viewer's browser fetch from the linked host, which is the leak Josh
  // ruled out.
  const remote = fn({ url: 'https://x.test', title: 't', image: 'https://evil.test/i.png' });
  assert.doesNotMatch(remote, /evil\.test/, 'a remote image URL reached the page');
  assert.doesNotMatch(remote, /lpv-img/);
});

test('every message row draws the preview card under its text', () => {
  for (const fn of ['dmRow', 'pjMsg', 'pjRoomRow']) {
    const body = page.lift(SCRIPT, fn);
    assert.match(body, /pjPreviewCard\((r|m)\.preview\)/, fn + ' does not draw the preview card');
  }
  // And a row with a preview really carries it (the real dmRow, both directions).
  const dm = new Function('CURRENT', lift(['asSentence', 'esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  const preview = { url: 'https://example.test/p', title: 'Page', site: 'example.test' };
  for (const m of [{ from: 'dana', text: 'see https://example.test/p', at: new Date().toISOString(), preview }, { from: 'you', you: true, text: 'see https://example.test/p', at: new Date().toISOString(), preview }]) {
    const html = dm(m, 'Dana');
    assert.match(html, /class="lpv"/, 'the card is missing from a row that carries a preview');
    assert.match(html, /class="xlink"/, 'the inline link went missing when the card arrived');
  }
  const plain = dm({ from: 'dana', text: 'hello', at: new Date().toISOString() }, 'Dana');
  assert.doesNotMatch(plain, /lpv/, 'a row with no preview drew a card');
});

/* ---- the attached document card (#358), page half ---------------------- */
test('an attachment card renders by kind from the upload route shape, and never as an empty card', () => {
  const fn = new Function(lift(['esc', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard']) + '\nreturn pjAttachmentCard;')();
  const base = { id: 'a1', name: 'Brief <v2>.pdf', type: 'application/pdf', size: 123456, url: '/api/attachment/a1', preview: '/api/attachment/a1/preview', kind: 'pdf' };
  const pdf = fn(base);
  assert.match(pdf, /^<a class="att att-pdf haspic" href="\/api\/attachment\/a1" download="Brief &lt;v2&gt;\.pdf">/);
  assert.match(pdf, /<img src="\/api\/attachment\/a1\/preview" alt="" loading="lazy">/);
  assert.match(pdf, /att-name">Brief &lt;v2&gt;\.pdf</, 'the name reached the page unescaped or was dropped');
  // The kind in a person's word, never the MIME type (#420, Josh names Word,
  // Excel, PowerPoint, PDF, screenshots as what he will upload).
  assert.match(pdf, /att-meta">PDF · 121 KB</);
  assert.equal(new Function('return ' + page.lift(SCRIPT, 'pjFileWord'))()('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx', 'other'), 'PowerPoint');
  assert.equal(new Function('return ' + page.lift(SCRIPT, 'pjFileWord'))()('', 'budget.xlsx', 'other'), 'Excel spreadsheet');
  assert.equal(new Function('return ' + page.lift(SCRIPT, 'pjFileWord'))()('image/png', 'Screenshot.png', 'image'), 'Image');
  assert.equal(new Function('return ' + page.lift(SCRIPT, 'pjFileWord'))()('application/octet-stream', 'thing.sketch', 'other'), 'SKETCH file');
  // An image shows itself; text and other show no picture even with a preview path.
  assert.match(fn({ ...base, kind: 'image', type: 'image/png' }), /att-image haspic/);
  assert.doesNotMatch(fn({ ...base, kind: 'text', preview: '/api/attachment/a1/preview' }), /att-pic/);
  assert.doesNotMatch(fn({ ...base, kind: 'other', preview: null }), /att-pic/);
  // No preview the board could make: name, type, size, never a blank picture.
  const bare = fn({ ...base, preview: null });
  assert.doesNotMatch(bare, /att-pic|haspic/);
  assert.match(bare, /att-name">Brief/);
  // Refusals: no attachment, a non-board url, a remote preview.
  for (const bad of [undefined, null, {}, { ...base, url: 'https://evil.test/f' }]) assert.equal(fn(bad), '', 'rendered for ' + JSON.stringify(bad));
  assert.doesNotMatch(fn({ ...base, preview: 'https://evil.test/p.png' }), /evil/, 'a remote preview reached the page');
  // An unknown kind falls back to other rather than to nothing.
  assert.match(fn({ ...base, kind: 'zip', preview: null }), /att att-other/);
});

test('every message row draws the attachment card, and the + and drop targets are wired, with no dead button', () => {
  for (const fn of ['dmRow', 'pjMsg', 'pjRoomRow']) {
    // Every file, via pjAttachmentCards (#420): a renderer drawing `m.attachment` alone shows one card of several.
    assert.match(page.lift(SCRIPT, fn), /pjAttachmentCards\((r|m)\)/, fn + ' does not draw every attachment card');
  }
  const words = codeOnly(PAGE);
  assert.match(words, /<button class="attachbtn" id="pj-attach"[^>]*aria-label="Add a file to this conversation"/, 'the room + is missing or unnamed');
  assert.match(words, /<button class="attachbtn" id="d-attach"[^>]*aria-label="Add a file to this conversation"/, 'the agent page + is missing or unnamed');
  assert.match(words, /Drop a file anywhere in the conversation to add it\./, 'the drop sentence is missing');
  // The + posts to the upload routes Angel specified, one per surface.
  /* The route's shape (#389): PUT the bytes to /attachment, then the
     surface's own sender posts the message with the id. */
  assert.match(SCRIPT, /'\/api\/project\/' \+ encodeURIComponent\(PJ_CURRENT\) \+ '\/attachment'/, 'the room + does not upload to the project attachment route');
  assert.match(SCRIPT, /'\/api\/agent\/' \+ encodeURIComponent\(CURRENT \? CURRENT\.sessionName : ''\) \+ '\/attachment'/, 'the agent + does not upload to the agent attachment route');
  assert.match(SCRIPT, /method: 'PUT',\s*\n\s*headers: \{ 'content-type': file\.type \|\| 'application\/octet-stream', 'x-attachment-name': encodeURIComponent\(file\.name\) \}/, 'the upload is not a raw PUT with the name in its header');
  /* Attach, then send (Josh, 2026-08-23 1:59 PM): a picked file waits on a
     chip beside the composer, and the surface's own sender carries every
     pending id with the words as `attachments`, clearing them on success. */
  assert.match(SCRIPT, /attachAdd\(where, \{ id: body\.attachment\.id, name: body\.attachment\.name \}\)/, 'the upload does not attach the file to the composer');
  assert.doesNotMatch(SCRIPT, /await where\.send\(/, 'the upload still sends on pick');
  assert.match(SCRIPT, /pendingIds\.length \? \{ text, attachments: pendingIds \} : \{ text \}/, 'the room sender does not carry the pending ids');
  assert.match(SCRIPT, /: \(pendingIds\.length \? \{ text, attachments: pendingIds \} : \{ text \}\)\)/, 'the talk sender does not carry the pending ids');
  assert.equal((SCRIPT.match(/else if \(attachList\(ATTACH_AGENT\)\.length\) sendTalk\(/g) || []).length, 2, 'Send (click and Enter) with files and no words does nothing on one of the two paths');
  /* Keyed by agent and by project, like the drafts: a switch repaints the
     right chips, and a send clears only the target it went to. */
  assert.match(SCRIPT, /const ATTACH_PENDING = \{ room: \{\}, agent: \{\} \};/, 'pending files are one list per composer, not keyed by target');
  assert.match(SCRIPT, /attachPaint\(ATTACH_AGENT\);\s*\/\/ this agent's pending files/, 'opening an agent does not repaint its own chips');
  assert.match(SCRIPT, /attachPaint\(ATTACH_ROOM\);\s*\/\/ this project's pending files/, 'opening a project does not repaint its own chips');
  assert.match(SCRIPT, /if \(pendingIds\.length\) attachClear\(ATTACH_AGENT, sentName\);/, 'the talk sender clears the current composer rather than the sent agent');
  assert.match(SCRIPT, /if \(pendingIds\.length\) attachClear\(ATTACH_ROOM, sentProject\);/, 'the room sender clears the current composer rather than the sent project');
  /* The room reads its text AFTER the names are substituted in. */
  assert.match(SCRIPT, /input\.value = attachList\(ATTACH_ROOM\)\.map\(\(r\) => r\.name\)\.join\(', '\);\n\s*const text = input\.value;/, 'the room sends the text captured before the names were put in the box');
  assert.match(PAGE, /id="pj-attach-file" type="file" multiple/, 'the room picker takes one file at a time');
  assert.match(PAGE, /id="d-attach-file" type="file" multiple/, 'the agent picker takes one file at a time');
  // The 25 MB limit is the route's; the page says so before sending.
  assert.match(SCRIPT, /file\.size > 25 \* 1024 \* 1024/);
});

test('a message that is only its attachment\'s name draws the card once, not the name twice (#358)', () => {
  const fn = new Function('CURRENT', lift(['asSentence', 'esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  const att = { id: 'a1', name: 'lease notes.txt', type: 'text/plain', size: 12, url: '/api/attachment/a1', preview: null, kind: 'text' };
  const only = fn({ from: 'dana', text: 'lease notes.txt', at: new Date().toISOString(), attachment: att }, 'Dana');
  assert.equal((only.match(/lease notes\.txt/g) || []).length, 2, 'expected the name in the card (text and download attribute) only');
  assert.doesNotMatch(only, /dm-b">lease notes\.txt/, 'the file name is drawn as the message words above its own card');
  const words = fn({ from: 'dana', text: 'here is the lease', at: new Date().toISOString(), attachment: att }, 'Dana');
  assert.match(words, /dm-b">here is the lease/, 'real words were dropped because a file came with them');
});

test('a message with several files draws every card, and hides the joined names the same way (#420)', () => {
  const fn = new Function('CURRENT', lift(['asSentence', 'esc', 'pjInline', 'pjPreviewCard', 'pjSize', 'pjWords', 'pjFiles', 'pjAttachmentCards', 'pjFileWord', 'pjAttachmentCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'placedWords', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  const a = { id: 'a1', name: 'one.txt', type: 'text/plain', size: 12, url: '/api/attachment/a1', preview: null, kind: 'text' };
  const b = { id: 'b2', name: 'two.pdf', type: 'application/pdf', size: 3000, url: '/api/attachment/b2', preview: '/api/attachment/b2/preview', kind: 'pdf' };
  const at = new Date().toISOString();
  /* The route serves both shapes: `attachments` (all) and `attachment` (the first). */
  const both = fn({ from: 'dana', text: 'one.txt, two.pdf', at, attachment: a, attachments: [a, b] }, 'Dana');
  assert.equal((both.match(/class="att att-/g) || []).length, 2, 'two files, one card');
  assert.ok(both.indexOf('one.txt') < both.indexOf('two.pdf'), 'the cards are out of order');
  assert.doesNotMatch(both, /dm-b">one\.txt, two\.pdf/, 'the joined names are drawn as words above their own cards');
  const captioned = fn({ from: 'dana', text: 'both of these', at, attachment: a, attachments: [a, b] }, 'Dana');
  assert.match(captioned, /dm-b">both of these/, 'the caption was dropped');
  assert.equal((captioned.match(/class="att att-/g) || []).length, 2);
  /* An older row with only `attachment` still draws its one card. */
  const old = fn({ from: 'dana', text: 'one.txt', at, attachment: a }, 'Dana');
  assert.equal((old.match(/class="att att-/g) || []).length, 1);
  assert.doesNotMatch(old, /dm-b">one\.txt/);
});
