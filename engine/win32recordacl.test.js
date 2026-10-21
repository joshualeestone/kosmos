'use strict';
/**
 * #6692: the release key list's record on Windows is the person's alone: only they, SYSTEM and Administrators may
 * reach its folder. The rule (judge) everywhere; the real access list read on Windows.
 *
 *   node --test engine/win32recordacl.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const acl = require('./win32recordacl');

const ON_WINDOWS = process.platform === 'win32';
const ME = 'S-1-5-21-1-2-3-1001';
const OTHER = 'S-1-5-21-1-2-3-1002';
const own = [{ sid: acl.SYSTEM_SID, allow: true }, { sid: acl.ADMINISTRATORS_SID, allow: true }, { sid: ME, allow: true }];
const answer = (rules, owner = ME) => ({ user: ME, dirs: [{ dir: 'C:\\Users\\me\\AppData\\Local\\Kosmos\\runtime', owner, rules }] });

test('#6692 judge: the profile shape (SYSTEM, Administrators, the person) passes', () => {
  assert.equal(acl.judge(answer(own)), null);
  assert.equal(acl.judge(answer([...own, { sid: acl.CREATOR_OWNER_SID, allow: true }])), null, 'CREATOR OWNER is whoever creates: this copy');
  assert.equal(acl.judge(answer([...own, { sid: 'S-1-1-0', allow: false }])), null, 'a deny entry takes access away');
  assert.equal(acl.judge(answer(own, acl.ADMINISTRATORS_SID)), null, 'owned by Administrators (made from an elevated prompt)');
});

test('#6692 judge: any other account allowed in is refused, named, with what to fix', () => {
  const cases = [
    ['S-1-5-32-545', /reached by Users\. Remove those entries/],
    ['S-1-5-11', /reached by Authenticated Users/],
    ['S-1-1-0', /reached by Everyone/],
    ['S-1-5-32-546', /reached by Guests/],
    ['S-1-5-4', /reached by INTERACTIVE/],
  ];
  for (const [sid, why] of cases) assert.match(acl.judge(answer([...own, { sid, allow: true }])), why, sid);
  assert.match(acl.judge(answer([...own, { sid: OTHER, name: 'PC\\guest2', allow: true }])), /reached by PC\\guest2/, 'a named other account');
  assert.match(acl.judge(answer([...own, { sid: OTHER, allow: true }])), new RegExp(OTHER), 'by SID when it has no name');
});

test('#6692 judge: owned by another account, or an answer that cannot be read, is refused', () => {
  assert.match(acl.judge(answer(own, OTHER)), /belongs to another account/);
  for (const bad of [null, {}, { user: ME, dirs: [] }, { user: '', dirs: answer(own).dirs }, { user: ME, dirs: [{ dir: 'x' }] }]) {
    assert.match(acl.judge(bad), /could not be read/, JSON.stringify(bad));
  }
});

test('#6692 judge: a FAT32 or exFAT drive (no access lists, no hard links) is refused with the reason', () => {
  for (const format of ['FAT32', 'exFAT']) {
    const r = acl.judge({ user: ME, dirs: [{ dir: 'E:\\Kosmos\\runtime', format, owner: null, rules: [] }] });
    assert.match(r, new RegExp(`is on a ${format} drive, which keeps no permissions and cannot make hard links`));
  }
  assert.equal(acl.judge({ user: ME, dirs: [{ dir: 'C:\\x', format: 'NTFS', owner: ME, rules: own }] }), null, 'CONTROL: NTFS is judged by its entries');
});

test('#6692 aclRefusal: off Windows, and when PowerShell fails, it refuses rather than passing', async () => {
  assert.match(await acl.aclRefusal(['/x'], { platform: 'darwin' }), /can only be read on Windows/);
  assert.match(await acl.aclRefusal(['C:\\x'], { platform: 'win32', read: async () => { throw new Error('boom'); } }), /could not be read \(boom\)/);
  assert.match(await acl.aclRefusal(['C:\\x', 'C:\\y'], { platform: 'win32', read: async () => answer(own) }), /could not be read/, 'one answer for two folders');
  assert.equal(await acl.aclRefusal(['C:\\x'], { platform: 'win32', read: async () => ({ user: ME, dirs: { dir: 'C:\\x', owner: ME, rules: own[2] } }) }), null, 'PowerShell\'s one-item arrays are read');
});

test('#6692 aclRefusal, real: a folder under the profile passes; the same folder granted Users read is refused', { skip: !ON_WINDOWS && 'reads a Windows access list', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-acl-6692-'));
  try {
    const seen = await acl.readAcls([dir]);
    const rules = [].concat(seen.dirs)[0].rules;
    /* What the runner's profile looks like, for the record (the PR quotes it). */
    process.stdout.write(`# profile folder access list: owner ${[].concat(seen.dirs)[0].owner === seen.user ? 'the running account' : [].concat(seen.dirs)[0].owner}; `
      + [].concat(rules).map((r) => `${r.sid === seen.user ? 'the running account' : (r.name || r.sid)} ${r.allow ? 'allow' : 'deny'}`).join(', ') + '\n');
    assert.equal(await acl.aclRefusal([dir]), null);
    cp.execFileSync('icacls', [dir, '/grant', '*S-1-5-32-545:(R)'], { stdio: 'ignore' });
    assert.match(await acl.aclRefusal([path.dirname(dir), dir]), /can also be reached by Users/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
