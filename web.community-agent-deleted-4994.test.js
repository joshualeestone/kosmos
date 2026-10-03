'use strict';

/**
 * #4994: a post the deleted agent published but never sent is recorded not_sent (it goes out under neither account),
 * and the owner's list says so. Before this, communityMineWord had no not_sent branch for POSTS (comments had one), so
 * the row's status read as nothing at all. communityMineWord is extracted from the page and CALLED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function sliceFn(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}
// eslint-disable-next-line no-new-func
const words = new Function(`${sliceFn('communityMineCommentWord')}\n${sliceFn('communityMineWord')}\nreturn communityMineWord;`)();

test('#4994: a post that was never sent says it stayed on this computer, the same words as a comment', () => {
  const post = words({ state: 'not_sent', reasons: ['agent_deleted'], agentDeleted: true });
  assert.equal(post, 'Not sent. It stayed on this computer.');
  assert.equal(words({ kind: 'comment', state: 'not_sent' }), post, 'a post and a comment that never left say it differently');
  assert.equal(post.includes('\u2014'), false, 'an em dash reached the owner');
});

test('#4994 CONTROL: it is not the owner-deleted words, which would claim a delete nobody made', () => {
  assert.equal(words({ state: 'withheld' }), 'Deleted before it was sent');
  assert.notEqual(words({ state: 'not_sent' }), words({ state: 'withheld' }));
});
