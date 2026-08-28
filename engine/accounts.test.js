'use strict';

/**
 * ⚠️ A SANDBOXED HOME, SET BEFORE THE MODULE LOADS. `accounts.js` resolves HOME
 * once at require time, and this suite writes `.claude*` directories — against
 * the operator's real home that is somebody's actual account tree. The same
 * lesson the status suite learned by writing into a real `~/.claude`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-accounts-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const accounts = require('./accounts');

const write = (rel, obj) => {
  const p = nodePath.join(SANDBOX, rel);
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
};

test('every signed-in account is found, with the default first', () => {
  /**
   * 🛑 THE DEFAULT KEEPS ITS RECORD SOMEWHERE ELSE, and this is the assertion
   * that would have caught it shipping. Measured on a real machine:
   *
   *   ~/.claude.json                     the DEFAULT account's record
   *   ~/.claude-account-b/.claude.json   an overridden config dir keeps its own
   *
   * There is no `~/.claude/.claude.json`. A uniform rule finds two accounts on a
   * machine with three and silently omits the one the product has always meant
   * by "your account".
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-two', 'projects'), { recursive: true });
  write('.claude-two/.claude.json', { oauthAccount: { emailAddress: 'second@example.com' } });

  const got = accounts.list();
  assert.deepEqual(got.map((a) => a.email), ['first@example.com', 'second@example.com'],
    'the default account is missing or is not first');
  assert.equal(got[0].isDefault, true);
  assert.equal(got[1].label, 'two', 'the label should be the part a person named');
});

test('a .claude- directory that is not signed in is not an account', () => {
  /**
   * ⚠️ MEASURED RATHER THAN ASSUMED: on the fleet machine `.claude-workers`
   * sits beside two real accounts and carries no `.claude.json` at all. It is a
   * config directory for something else. The presence of an `oauthAccount` is
   * what makes a directory an account, not the name.
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-notalogin', 'projects'), { recursive: true });
  const emails = accounts.list().map((a) => a.email);
  assert.ok(!emails.includes(null), 'a directory with no account record was listed as an account');
  assert.equal(emails.length, 2, 'a non-account directory was counted');

  /* And a config that exists but has no oauthAccount is the same answer. */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-halfway', 'projects'), { recursive: true });
  write('.claude-halfway/.claude.json', { somethingElse: true });
  assert.equal(accounts.list().length, 2, 'a config with no account record was counted');
});

test('an account whose memory could not be found says so', () => {
  /**
   * 🔑 THE CONSTRAINT THAT DECIDES WHERE THESE DIRECTORIES LIVE.
   * `status.configRoots()` finds `~/.claude` and any `~/.claude-*` that contains
   * a `projects` directory, and that is how a memory reading is located. So an
   * account directory without one is an account whose agents will all read
   * Unknown — which after today looks exactly like the defect we spent the
   * evening killing.
   *
   * 📌 Reported rather than hidden, because the screen that offers the choice
   * has to be able to say what the choice costs.
   */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-nomem'), { recursive: true });
  write('.claude-nomem/.claude.json', { oauthAccount: { emailAddress: 'third@example.com' } });
  const found = accounts.list().find((a) => a.email === 'third@example.com');
  assert.ok(found, 'the account was not listed at all');
  assert.equal(found.memoryReadable, false,
    'an account with nowhere to keep transcripts is being reported as fine');
});

test('a prepared account shares the one memory tree, so an agent keeps its history', () => {
  /**
   * 🔑 JOSH'S RULE, 2026-08-22: *"her memory should follow her everywhere she
   * goes"* — across models, accounts, and providers. A principle rather than a
   * setting, so it is encoded here rather than offered as a choice.
   *
   * 🛑 WITHOUT IT A SECOND ACCOUNT IS A QUIET AMNESIA, and the fleet has the
   * write-up: *"An agent restarted onto a fresh account comes up with no
   * memory, and nothing on screen says so. It looks like a working agent and
   * behaves like a blank one."*
   */
  const made = accounts.prepare('Work Account');
  assert.equal(made.ok, true, made.because);
  assert.equal(made.label, 'work-account', 'the label was not made safe for a directory name');
  assert.equal(nodePath.basename(made.dir), '.claude-work-account',
    'the directory is named something status.configRoots() will never scan');
  assert.equal(made.memoryShared, true, 'the account got its own empty history');

  /* The link points at the ONE tree, so a transcript written under either
     account is found under both. */
  const shared = nodePath.join(SANDBOX, '.claude', 'projects');
  fs.writeFileSync(nodePath.join(shared, 'proof.txt'), 'x', 'utf8');
  assert.ok(fs.existsSync(nodePath.join(made.dir, 'projects', 'proof.txt')),
    'the new account cannot see history written on the first one');

  /* And it is listed once it is signed in, not before: a directory with no
     account record is not an account. */
  assert.ok(!accounts.list().some((a) => a.dir === made.dir),
    'an empty directory is being offered as a connected account');
  write('.claude-work-account/.claude.json', { oauthAccount: { emailAddress: 'work@example.com' } });
  const now = accounts.list().find((a) => a.dir === made.dir);
  assert.ok(now, 'a signed-in account is not listed');
  assert.equal(now.memoryReadable, true);
});

test('preparing an account twice does not disturb history that is already there', () => {
  /**
   * 🛑 THE AMNESIA ARRIVING FROM THE OTHER DIRECTION. If a `projects` directory
   * is already sitting in an account folder it is somebody's existing history,
   * and replacing it with a link would be this product deleting the thing it
   * exists to protect. Re-running must be safe.
   */
  const first = accounts.prepare('twice');
  assert.equal(first.memoryShared, true);
  const again = accounts.prepare('twice');
  assert.equal(again.ok, true);
  assert.equal(again.memoryShared, true, 're-running lost the shared tree');

  /* A REAL directory there is left exactly alone, and reported honestly. */
  const own = nodePath.join(SANDBOX, '.claude-hasown');
  fs.mkdirSync(nodePath.join(own, 'projects', 'something'), { recursive: true });
  const kept = accounts.prepare('hasown');
  assert.equal(kept.memoryShared, false,
    'an account with its own history is being reported as sharing the common one');
  assert.ok(fs.existsSync(nodePath.join(own, 'projects', 'something')),
    'existing history was destroyed to make room for a link');
});

/* ---- memoryShared, and the repair that makes it true ---------------------
   🔑 THIS IS THE FIELD THE MOVE IS GATED ON. `memoryReadable` only asks whether
   a transcripts tree exists here; an account with its OWN tree passes that and
   still gives any agent moved onto it a blank past. */

test('an account with its own separate history is NOT shared, and the one that is says so', () => {
  const home = accounts.HOME_FOR_TEST;
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // its own tree
  fs.mkdirSync(nodePath.join(home, '.claude-own', 'projects'), { recursive: true });
  write('.claude-own/.claude.json', { oauthAccount: { emailAddress: 'own@example.com' } });

  // pointed at the primary, the way prepare() and this machine's own accounts are
  fs.mkdirSync(nodePath.join(home, '.claude-linked'), { recursive: true });
  write('.claude-linked/.claude.json', { oauthAccount: { emailAddress: 'linked@example.com' } });
  fs.symlinkSync(nodePath.join(home, '.claude', 'projects'), nodePath.join(home, '.claude-linked', 'projects'));

  const by = Object.fromEntries(accounts.list().map((a) => [a.email, a]));
  assert.equal(by['first@example.com'].memoryShared, true, 'the primary is trivially shared with itself');
  assert.equal(by['linked@example.com'].memoryShared, true, 'a link to the primary was not recognised');

  /* ⚠️ THE ONE THAT MATTERS. Both of these accounts have a readable tree, so
     `memoryReadable` cannot tell them apart -- which is exactly why a second
     field exists rather than a stricter reading of the first. */
  assert.equal(by['own@example.com'].memoryReadable, true, 'the premise: its tree is readable');
  assert.equal(by['own@example.com'].memoryShared, false,
    'an account with its own history read as safe to move an agent onto');
});

test('share() points an existing account at the one tree, and refuses to delete real history', () => {
  const home = accounts.HOME_FOR_TEST;
  fs.mkdirSync(nodePath.join(home, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'first@example.com' } });

  // empty tree: safe to swap, and the common case for an account that has never run an agent
  fs.mkdirSync(nodePath.join(home, '.claude-empty', 'projects'), { recursive: true });
  write('.claude-empty/.claude.json', { oauthAccount: { emailAddress: 'empty@example.com' } });
  const empty = nodePath.join(home, '.claude-empty');
  assert.equal(accounts.sharesMemory(empty, false), false, 'the premise: it starts unshared');
  assert.deepEqual(accounts.share(empty), { ok: true, already: false });
  assert.equal(accounts.sharesMemory(empty, false), true, 'the repair did not take');

  /* 🛑 AND IT WILL NOT DELETE SOMEBODY'S ACTUAL HISTORY. Replacing a real tree
     with a link is the amnesia this whole area exists to prevent, arriving
     from the other direction. */
  const full = nodePath.join(home, '.claude-full');
  fs.mkdirSync(nodePath.join(full, 'projects', '-Users-someone-work'), { recursive: true });
  fs.writeFileSync(nodePath.join(full, 'projects', '-Users-someone-work', 'a.jsonl'), '{}\n');
  write('.claude-full/.claude.json', { oauthAccount: { emailAddress: 'full@example.com' } });
  const refused = accounts.share(full);
  assert.equal(refused.ok, false);
  assert.match(refused.because, /will not delete it/);
  assert.ok(fs.existsSync(nodePath.join(full, 'projects', '-Users-someone-work', 'a.jsonl')),
    'the refusal still ate the history it refused to eat');

  // and sharing something already shared is a no-op that says so
  assert.deepEqual(accounts.share(empty), { ok: true, already: true });
});

test('#248: nextWorkDir finds the first free spot, reuses unclaimed leftovers, skips signed-in accounts', () => {
  const home = accounts.HOME_FOR_TEST;
  /* Fresh: nothing named work-anything exists yet, so the first spot. */
  const first = accounts.nextWorkDir();
  assert.equal(first.label, 'work1');
  assert.equal(first.dir, nodePath.join(home, '.claude-work1'));

  /* A signed-in work1 is somebody's account: skipped, never offered. */
  fs.mkdirSync(nodePath.join(home, '.claude-work1'), { recursive: true });
  fs.writeFileSync(nodePath.join(home, '.claude-work1', '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'w1@example.com' } }));
  assert.equal(accounts.nextWorkDir().label, 'work2');

  /* An UNCLAIMED work2 (a cancelled attempt's leftover: directory, no
     identity) is reused, so retries do not litter work3, work4, ... */
  fs.mkdirSync(nodePath.join(home, '.claude-work2'), { recursive: true });
  assert.equal(accounts.nextWorkDir().label, 'work2');

  /* Present-but-unreadable is NOT absent: a damaged config may be
     somebody's signed-in account, and offering it would overwrite their
     credentials. Skipped. */
  fs.writeFileSync(nodePath.join(home, '.claude-work2', '.claude.json'), '{not json');
  assert.equal(accounts.nextWorkDir().label, 'work3');

  /* And a dir carrying a REAL projects tree is somebody's history, not a
     spot; prepare would refuse to wire it, so it is never offered. */
  fs.mkdirSync(nodePath.join(home, '.claude-work3', 'projects'), { recursive: true });
  assert.equal(accounts.nextWorkDir().label, 'work4');

  /* A BROKEN projects symlink is not free either (iteration 3, measured):
     prepare can never claim it (it will not replace an existing link), so
     calling it free wedges every future attempt on the same dead spot.
     The two ENOENTs, no entry at all versus a link whose target does not
     resolve, must not be conflated. */
  fs.mkdirSync(nodePath.join(home, '.claude-work4'), { recursive: true });
  fs.symlinkSync(nodePath.join(home, 'nowhere-real'), nodePath.join(home, '.claude-work4', 'projects'));
  assert.equal(accounts.nextWorkDir().label, 'work5');
});

/* ---- #881: listLive() ---------------------------------------------------
   Injected runner throughout (subscription.js's own test seam), never a
   real `claude auth status` call. */
test('#881: listLive() attaches a live connection to every row, in parallel', async () => {
  // ⚠️ FOUND BY name, NOT array position/length: this suite shares one
  // sandbox HOME across every test() in the file (earlier tests, e.g.
  // #248's nextWorkDir sweep, leave their own .claude-workN accounts
  // behind), matching the pattern the file's own earlier tests already use
  // (`.find((a) => a.email === ...)`) rather than assuming a clean slate.
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'default-881@example.com' } });
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-live881', 'projects'), { recursive: true });
  write('.claude-live881/.claude.json', { oauthAccount: { emailAddress: 'second-881@example.com' } });

  const subscription = require('./subscription');
  const seenConfigDirs = {}; // keyed by dir, since Promise.all resolution order is not row order
  subscription.setRunner(async (env) => {
    // The runner alone cannot see which row it is answering for -- inferred
    // here from the presence/absence of the override itself, which is
    // exactly the thing under test.
    seenConfigDirs[env.CLAUDE_CONFIG_DIR || '<none>'] = true;
    return { stdout: JSON.stringify({ loggedIn: true }), err: null };
  });
  try {
    const got = await accounts.listLive();
    const def = got.find((a) => a.email === 'default-881@example.com');
    const other = got.find((a) => a.email === 'second-881@example.com');
    assert.ok(def && other, 'both fixture accounts must be found');
    assert.equal(def.connection.state, subscription.STATE.CONNECTED);
    assert.equal(def.connection.checkedLive, true);
    assert.equal(other.connection.state, subscription.STATE.CONNECTED);

    /* 🛑 THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG THIS CARD FOUND ITSELF:
       the default row must NOT pass its own `dir` as CLAUDE_CONFIG_DIR.
       Measured live (see the plan): configFile() already treats the default
       account's record as a SIBLING of <HOME>/.claude, not a file inside
       it, and CLAUDE_CONFIG_DIR=<HOME>/.claude makes the real `claude`
       binary look INSIDE that directory instead -- landing on a stale or
       absent file even when the account is genuinely signed in. */
    assert.ok(seenConfigDirs['<none>'], 'at least one check (the default row) must run with no CLAUDE_CONFIG_DIR override');
    assert.ok(seenConfigDirs[nodePath.join(SANDBOX, '.claude-live881')],
      'the non-default row must be scoped to its own directory');
  } finally { subscription.setRunner(null); }
});

test('#881: listLive() answers UNKNOWN for one account\'s failed check without sinking the others', async () => {
  /* ⚠️ THIS EXERCISES checkLive()'s OWN internal catch (a thrown runner),
     NOT listLive()'s try/catch around it -- checkLive() never rejects by
     contract (every internal failure resolves to {state: UNKNOWN, ...}),
     so listLive()'s own catch is unreachable from here. See the separate
     test below for that one, which monkey-patches subscription.checkLive
     itself to actually reject. */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'default-881b@example.com' } });
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-live881b', 'projects'), { recursive: true });
  write('.claude-live881b/.claude.json', { oauthAccount: { emailAddress: 'second-881b@example.com' } });

  const subscription = require('./subscription');
  subscription.setRunner(async (env) => {
    if (env.CLAUDE_CONFIG_DIR) throw new Error('simulated failure for the non-default account only');
    return { stdout: JSON.stringify({ loggedIn: true }), err: null };
  });
  try {
    const got = await accounts.listLive();
    const def = got.find((a) => a.isDefault);
    const other = got.find((a) => a.email === 'second-881b@example.com');
    assert.ok(def && other, 'both fixture accounts must be found');
    assert.equal(def.connection.state, subscription.STATE.CONNECTED, 'the default row is unaffected by the other row\'s failure');
    assert.equal(other.connection.state, subscription.STATE.UNKNOWN, 'a failed check reads as unknown, never none');
    assert.match(other.connection.because, /could not reach Claude Code/);
  } finally { subscription.setRunner(null); }
});

test('#881: listLive()\'s OWN catch answers UNKNOWN if checkLive() itself ever rejected', async () => {
  /* checkLive() never rejects today (verified in subscription.test.js),
     but listLive()'s Promise.all wraps each call in its own try/catch as
     defense in depth against that contract ever regressing -- untested
     until now, since nothing could make checkLive() itself throw. Module
     caching makes this safe to monkey-patch: accounts.js's own
     require('./subscription') inside listLive() returns this exact same
     object. */
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'default-881c@example.com' } });
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude-live881c', 'projects'), { recursive: true });
  write('.claude-live881c/.claude.json', { oauthAccount: { emailAddress: 'second-881c@example.com' } });

  const subscription = require('./subscription');
  const real = subscription.checkLive;
  subscription.checkLive = async () => { throw new Error('checkLive itself rejected, not just its internal runner'); };
  try {
    const got = await accounts.listLive();
    const def = got.find((a) => a.email === 'default-881c@example.com');
    const other = got.find((a) => a.email === 'second-881c@example.com');
    assert.ok(def && other, 'both fixture accounts must be found');
    assert.equal(def.connection.state, subscription.STATE.UNKNOWN, 'listLive()\'s own catch must answer unknown, never none, and never throw');
    assert.equal(other.connection.state, subscription.STATE.UNKNOWN);
    assert.match(def.connection.because, /could not check this account/);
  } finally { subscription.checkLive = real; }
});

test('#881: list() itself is unchanged -- no connection field, no live check', () => {
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  write('.claude.json', { oauthAccount: { emailAddress: 'default@example.com' } });
  const got = accounts.list();
  assert.equal(got[0].connection, undefined, 'list() must stay exactly as fast/cheap as the 5-second status tick needs');
});

/**
 * #1419: `list()` must follow a HOME set after this module was required.
 *
 * 🛑 WHY THIS EXISTS. `HOME` was a module-level `const`, resolved once at
 * require time, and 12 call sites read it. A caller that set
 * `AGENT_WORKFORCE_HOME` AFTER requiring this module read straight past the
 * seam: `list()` returned the OPERATOR'S REAL ACCOUNTS, by their real email
 * addresses, while the caller believed it was sandboxed.
 *
 * ⭐ MEASURED, three arms, the third being the one that makes the others mean
 * something:
 *   pre-fix,  set after require  -> 4 accounts, the real machine's
 *   post-fix, set after require  -> 2, the fixture's
 *   post-fix, set before require -> 2, the fixture's
 *
 * 📌 AND THE FIXTURE IS BUILT THE WAY THIS FILE BUILDS ONE, deliberately. My
 * first attempt at measuring this used a hand-made `.credentials.json`, which
 * is not what the module recognises, so the control returned 0 and proved
 * nothing. A fixture you invent encodes your BELIEF about the input; the
 * suite's own shape encodes what the code actually requires.
 */
test('#1419: list() follows AGENT_WORKFORCE_HOME set after require, not the one frozen at load', () => {
  const late = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-accounts-late-'));
  fs.mkdirSync(nodePath.join(late, '.claude', 'projects'), { recursive: true });
  fs.mkdirSync(nodePath.join(late, '.claude-beta', 'projects'), { recursive: true });
  fs.writeFileSync(nodePath.join(late, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'late-primary@example.com' } }));
  fs.writeFileSync(nodePath.join(late, '.claude-beta', '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'late-beta@example.com' } }));

  const before = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = late;
  try {
    const emails = accounts.list().map((a) => a.email);
    assert.ok(emails.includes('late-beta@example.com'),
      'list() did not see an account under the HOME set after require: it is frozen again, and a caller that sandboxes late is reading the real machine');
    assert.ok(emails.includes('late-primary@example.com'),
      'the default entry did not follow either, so this test is not comparing what it claims to');
    /* THE ARM THAT MATTERS: nothing from the real machine leaked in. Kept
       shape-based rather than naming a real address, so it stays true on any
       operator's machine. */
    assert.ok(emails.every((e) => String(e).endsWith('@example.com')),
      'a real account from the operator\'s machine appeared in a sandboxed list: ' + JSON.stringify(emails));
  } finally {
    if (before === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = before;
  }
});
