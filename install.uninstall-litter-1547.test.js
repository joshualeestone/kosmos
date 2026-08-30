'use strict';

/**
 * The uninstall removes OUR bookkeeping and keeps THEIRS (#1547).
 *
 * ⭐ WHY: `engine/wouldping.js` writes a would-ping log into the data folder
 * during normal running (#1494), and the uninstall left it there. Somebody who
 * removed Kosmos found our ping-logs sitting in their AgentWorkforce folder.
 * Leave-no-trace applies to what we generated; it must never apply to what they
 * made.
 *
 * 🛑 THE CONTROL IS THE POINT. An assertion that `wouldping/` is gone is easy to
 * satisfy by deleting the whole data folder, which is the catastrophe this
 * card's fix must not become. So every arm that asserts our litter is gone also
 * asserts a seeded USER file survived, byte for byte.
 *
 *   node --test install.uninstall-litter-1547.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');

/* A sandboxed install: its own KOSMOS_HOME and its own data root, so the
   uninstall's sandbox refusal is satisfied and nothing real is in reach. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall1547-'));
  const home = path.join(root, 'kosmos-home');
  const dataParent = path.join(root, 'data');
  /* 🛑 THE STORE ROOT IS A CHILD OF AGENT_WORKFORCE_DATA, NOT THE VARIABLE
     ITSELF. `engine/store.js:85` joins `AgentWorkforce` onto it, and
     `engine/wouldping.js` writes under `store.ROOT`. An earlier version of this
     fixture seeded `data/wouldping/` -- where a BUGGY sweep looked -- so all
     three arms passed against a sweep that never found the real file. The
     fixture supplied the premise instead of testing it, which is the
     hand-rolled-fixture defect in its most expensive form: the test defended
     the bug. */
  const data = path.join(dataParent, 'AgentWorkforce');
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  /* 🛑 SEEDS AN AGENT PLIST SO THE `_agents_stopped=yes` CLOSING BRANCH IS REACHED.
     Without one the uninstall takes the short "Kosmos is removed." line, and every
     assertion about the long closing sentence passes or fails for the wrong reason:
     a doesNotMatch against text that branch never prints is vacuous. The plist must
     name THIS install's supervisor (setup.sh:1067) or the loop skips it as another
     install's job, which is itself the check that makes this fixture honest. */
  const launch = path.join(root, 'launch');
  fs.mkdirSync(launch, { recursive: true });
  fs.writeFileSync(path.join(launch, 'com.kosmos.agent.angel.plist'),
    '<plist><dict><key>ProgramArguments</key><array><string>'
    + path.join(dataParent, 'AgentWorkforce', 'bin', 'agent-supervisor.sh')
    + '</string></array></dict></plist>\n');
  for (const d of ['wouldping', 'liveness', 'downloads', 'usage', 'sendertokens', 'selfreports']) {
    fs.mkdirSync(path.join(data, d), { recursive: true });
    fs.writeFileSync(path.join(data, d, 'ours.bin'), 'kosmos\n');
  }
  /* The person's, one from each class named in setup.sh's table. `secrets` is the
     one that would hurt most: we wrote the files, the keys inside are theirs. */
  fs.mkdirSync(path.join(data, 'chats'), { recursive: true });
  fs.mkdirSync(path.join(data, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(data, 'chats', 'a.json'), '{"theirs":1}\n');
  fs.writeFileSync(path.join(data, 'secrets', 'key.env'), 'THEIR_KEY=1\n');
  fs.writeFileSync(path.join(data, 'connect.json'), '{"decided":1}\n');
  fs.mkdirSync(path.join(data, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(data, 'wouldping', 'needs-you.jsonl'), '{"seen":1}\n');
  fs.writeFileSync(path.join(data, 'liveness', 'angel.json'), '{"beat":1}\n');
  // the person's own data, which must survive byte for byte
  fs.writeFileSync(path.join(data, 'projects.json'), '{"mine":true}\n');
  fs.writeFileSync(path.join(data, 'profiles', 'angel.json'), '{"name":"Angel"}\n');
  return { root, home, data, dataParent };
}

function runUninstall(sb) {
  try {
    return execFileSync('bash', [SETUP, '--uninstall'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        KOSMOS_HOME: sb.home,
        AGENT_WORKFORCE_DATA: sb.dataParent,
        AGENT_WORKFORCE_LAUNCH: path.join(sb.root, 'launch'),
        KOSMOS_APP_DIR: path.join(sb.root, 'apps'),
        KOSMOS_SYS_APP_DIR: path.join(sb.root, 'sysapps'),
      },
    });
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || ''));
  }
}

test('the ping log goes and the person\'s files stay', () => {
  const sb = sandbox();
  try {
    // control BEFORE: both exist, or the assertions below are vacuous
    assert.ok(fs.existsSync(path.join(sb.data, 'wouldping', 'needs-you.jsonl')),
      'control: the ping log was never seeded');
    assert.ok(fs.existsSync(path.join(sb.data, 'projects.json')),
      'control: the user file was never seeded');

    for (const d of ['wouldping', 'liveness', 'downloads', 'usage', 'sendertokens', 'selfreports']) {
      assert.ok(fs.existsSync(path.join(sb.data, d, 'ours.bin')),
        'control: ' + d + ' was never seeded, so its assertion below is vacuous');
    }

    const out = runUninstall(sb);

    /* 🛑 ALL SIX, NOT THE ONE THE CARD NAMED. The card was filed about wouldping;
       sweeping only what the report named is how a class ships half-fixed, and
       `downloads` is the member that actually costs the person space (~281MB). */
    for (const d of ['wouldping', 'liveness', 'downloads', 'usage', 'sendertokens', 'selfreports']) {
      assert.ok(!fs.existsSync(path.join(sb.data, d)),
        'our own ' + d + ' survived the uninstall, so Kosmos left its bookkeeping behind');
    }

    /* 🛑 AND THE OTHER DIRECTION, WHICH IS THE ONE THAT COULD RUIN SOMEBODY'S DAY.
       secrets/ is written BY US and holds THEIR keys, which is exactly the case a
       "we wrote it, so it is ours" rule gets wrong. */
    assert.equal(fs.readFileSync(path.join(sb.data, 'secrets', 'key.env'), 'utf8'), 'THEIR_KEY=1\n',
      'the uninstall destroyed the person\'s credentials');
    assert.equal(fs.readFileSync(path.join(sb.data, 'chats', 'a.json'), 'utf8'), '{"theirs":1}\n',
      'the uninstall reached into the person\'s conversations');
    assert.ok(fs.existsSync(path.join(sb.data, 'connect.json')),
      'the uninstall removed a record of the person\'s own decisions');

    /* ⚠️ THE POSITIVE HALF. Every other assertion here is an ABSENCE, and the
       sibling test's `doesNotMatch` passes just as happily when the script died
       before reaching the sweep. Nothing asserted the person is ever TOLD what
       was removed, which is the reversibility contract this file's header owes. */
    assert.match(out, /removed Kosmos's own leftover files/,
      'the uninstall removed our files without telling the person');
    /* ⚠️ NOT "records about your agents". Three of the six are not that: downloads is
       provider binaries, usage is a cache from the person's own transcripts,
       sendertokens are credentials. And the line fires on machines with no agents at
       all, where setup.sh:1405 forbids mentioning agents. */
    assert.doesNotMatch(out, /removed the records Kosmos kept about your agents/,
      'the sweep line describes the removal as agent records, which three of the six are not');

    /* 🛑 THE ARM FOR THE BLOCKER THIS SWEEP CREATED AND THEN HAD TO UNDO. The closing
       sentence used to say agents' files were left alone IN THIS FOLDER. `liveness/`
       and `selfreports/` are keyed per agent inside it (`liveness/angel.json`), so the
       moment the sweep took them the sentence became false, and nothing failed. An
       uninstall's last line exists to say truthfully what survived. */
    assert.doesNotMatch(out, /their files were left alone/,
      'the closing line claims agents files were left alone while per-agent records were removed');
    assert.match(out, /Kosmos.s own leftover files/,
      'the closing line no longer says the leftover files went, so it under-reports what was removed');
    assert.match(out, /own folders, and your projects,\s+conversations and sign-ins, were left alone/,
      'the closing line no longer names what actually survived');
    assert.doesNotMatch(out, /wouldping|liveness|sendertokens|selfreports|downloads|usage|_litter|store\.ROOT/,
      'a module name reached the person uninstalling the app: ' + out);
    assert.equal((out.match(/removed Kosmos's own leftover files/g) || []).length, 1,
      'the removal is announced once per directory, so six removals read as more than happened');

    // 🛑 THE ARM THAT STOPS THE FIX BECOMING THE DISASTER. Deleting the whole
    // data folder would satisfy the assertion above and destroy the person's work.
    assert.equal(fs.readFileSync(path.join(sb.data, 'projects.json'), 'utf8'), '{"mine":true}\n',
      'the uninstall removed or altered the person\'s own data');
    assert.equal(fs.readFileSync(path.join(sb.data, 'profiles', 'angel.json'), 'utf8'), '{"name":"Angel"}\n',
      'the uninstall reached into a user subfolder');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a sweep that CANNOT remove something says so, names it, and does not claim it went', () => {
  /* 🛑 THE ONLY ARM ON THE FAILURE PATH, AND IT DID NOT EXIST. Both info sites were
     added in one commit; one had three assertions and the other had none, so the only
     new failure-reporting code in the change was the half nobody drove. Inserting an
     unconditional failure left the suite 3/3 green.
     ⚠️ WORSE, THE CLOSING LINE WAS UNCONDITIONAL: the person could be told in ONE
     transcript that a file could not be removed AND that it was removed. */
  const sb = sandbox();
  const stuck = path.join(sb.data, 'liveness');
  try {
    fs.chmodSync(stuck, 0o500);           // directory readable, entry not removable
    const out = runUninstall(sb);

    assert.ok(fs.existsSync(path.join(stuck, 'angel.json')),
      'control: the directory was removable after all, so this test proves nothing about the failure path');

    assert.match(out, /could not remove .*liveness/,
      'the uninstall could not remove a directory and did not say which one');
    assert.match(out, new RegExp(sb.data.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the note names no path, so the person cannot find what was left behind');

    /* 🛑 THE CONTRADICTION ARM. The closing line must not assert the removal happened
       while a note four lines above says it did not. */
    assert.doesNotMatch(out, /and so were\s+Kosmos's own leftover files/,
      'the closing line claims the leftover files went while the transcript says one could not be removed');
  } finally {
    try { fs.chmodSync(stuck, 0o700); } catch { /* best effort, temp dir */ }
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a data folder with no ping log is left entirely alone', () => {
  /* The sweep must be conditional: a machine that never logged a would-ping
     should see no removal message and lose nothing. */
  const sb = sandbox();
  /* ⚠️ ALL SIX, OR THIS TEST IS ABOUT A FOLDER THAT STILL HAS LITTER IN IT. It caught
     exactly that when the swept list grew from two to six and this line did not. */
  for (const d of ['wouldping', 'liveness', 'downloads', 'usage', 'sendertokens', 'selfreports']) {
    fs.rmSync(path.join(sb.data, d), { recursive: true, force: true });
  }
  try {
    const out = runUninstall(sb);

    /* 🛑 POSITIVE CONTROL FIRST, OR THE ABSENCE BELOW IS VACUOUS. A script that
       `die`s before reaching the sweep announces nothing either, so without this
       line the assertion passes hardest exactly when the uninstall is broken. */
    assert.match(out, /Kosmos is removed/,
      'control: the uninstall never ran to completion, so announcing nothing proves nothing');

    assert.doesNotMatch(out, /removed the records Kosmos kept/,
      'the uninstall announced removing records that were never there');
    assert.ok(fs.existsSync(path.join(sb.data, 'projects.json')),
      'the person\'s data did not survive an uninstall with no litter to sweep');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('the sweep names its folders rather than pattern-matching the data root', () => {
  /**
   * ⚠️ A PROPERTY OF THE SOURCE, deliberately. The behavioural arms above
   * cannot tell "removed wouldping/" from "removed everything matching a
   * pattern that happened to hit only wouldping/ in this fixture". This file's
   * whole rule is that an uninstall proves ownership before it deletes, and a
   * glob over somebody's data folder is how an uninstaller removes the thing it
   * promised to keep.
   */
  const src = fs.readFileSync(SETUP, 'utf8');
  /* ⚠️ PINS THE ONE DERIVATION, NOT A SPELLING. An earlier version pinned
     `$_data_root/wouldping`, a second derivation of a path this file already
     computes -- so the CORRECT fix reddened the test and the guard actively
     cemented the defect it was written to prevent. */
  assert.match(src, /rm -rf "\$_support\/\$_litter"/,
    'the litter sweep is gone, or no longer uses the single existing derivation');
  /* ⚠️ THE COUNT AND THE LIST MUST AGREE, which is the discipline the remembered-answer
     block 40 lines up already carries. This is a spelling pin and is admitted as one:
     it catches a member silently dropped, not a member never added. */
  const listed = (src.match(/for _litter in ([a-z0-9 _-]+); do/) || [])[1] || '';
  assert.equal(listed.trim().split(/\s+/).length, 6,
    'the swept list is no longer six members; update the SIX in the comment above it too: ' + listed);
  assert.match(src, /SIX DIRECTORIES, AND IF YOU ADD A SEVENTH/,
    'the count discipline was removed from the comment');
  /* ⚠️ NARROWER THAN ITS MESSAGE, SAID PLAINLY: this catches one spelling of a whole-
     folder delete, not the class. `rm -rf "${_support}"` and a bare `$_support` both
     pass it. The behavioural arm above is what actually protects the person's files;
     this only catches an obvious revert. */
  assert.doesNotMatch(src, /rm -rf "\$_support"[^/]/,
    'the exact spelling `rm -rf "$_support"` appeared, which removes the whole data folder');
});
