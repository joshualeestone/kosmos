'use strict';

/**
 * Where the platform keeps what it creates.
 *
 * The rule from the storage split: **the user's project folder holds their
 * work and nothing of ours.** Everything the platform generates lives in app
 * data, keyed by agent. That is what makes it safe to point an agent at a
 * folder someone already has — including one under version control — without
 * quietly adding our files to their repo.
 *
 * macOS convention, so backup, Time Machine and cleanup behave the way people
 * already expect.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// ⚠️ `ping.js` requires THIS module at its top (for ROOT), so the identity
// stamp below requires ping at CALL time, never at load: a top-level
// require here would hand ping a half-built exports object and ROOT would
// be undefined at its BASE line. Same pattern discover.js uses for create.

const APP = 'AgentWorkforce';
/* `engine/commitments.js` honours the same variable, so this is two modules
   agreeing rather than a new convention. */
/**
 * The per-user application-data directory for ONE platform, as a pure function
 * of the things that decide it (#570).
 *
 * 🛑 THIS WAS A HARDCODED MAC PATH AND IT DOES NOT FAIL ON WINDOWS, WHICH IS
 * WHY IT NEEDED FINDING RATHER THAN WAITING FOR IT TO BREAK.
 * `path.join(homedir(), 'Library', 'Application Support', APP)` on Windows
 * happily creates `C:\\Users\\x\\Library\\Application Support\\AgentWorkforce`.
 * Nothing throws. The person's agents, profiles and avatars simply live somewhere
 * Windows does not consider application data: not roaming, not where an
 * uninstaller looks, not anywhere they would think to look themselves.
 *
 * ⚠️ AND IT IS EXPENSIVE TO FIX LATER, which is the argument for doing it before
 * a single Windows install exists rather than after. Once somebody's store is at
 * the wrong path, changing this is a data migration on a machine we cannot see.
 *
 * 🔑 A PURE FUNCTION OF (platform, homedir, env) SO A TEST CAN ASK ABOUT WINDOWS
 * FROM A MAC. `process.platform` cannot be set, so a module that reads it
 * directly is a module whose Windows behaviour is unassertable from here, and
 * unassertable is how this defect survived in the first place.
 *
 * 📌 LINUX IS KNOWINGLY UNHANDLED and falls through to the mac path, exactly as
 * it did before this change. That is wrong (XDG says
 * `$XDG_DATA_HOME` or `~/.local/share`) and it is not a regression, and this
 * card is Windows. Stated rather than left for somebody to discover in a switch
 * with no default comment.
 */
/**
 * The joiner for the platform being ASKED ABOUT, not the one we are running on.
 *
 * 🛑 THE PARAMETERISATION WAS NOT ENOUGH, AND THIS IS THE HALF THAT WAS MISSING
 * (#1510, Renet Tilley). `dataRootFor` takes a platform precisely so a Mac can ask
 * it about Windows. It then joined with the AMBIENT `path`, which off Windows IS
 * `path.posix`, so the win32 branch answered with forward slashes:
 *
 *   dataRootFor('win32', 'C:\\Users\\jo', {})
 *     ->  C:\Users\jo/AppData/Roaming/AgentWorkforce    <- what a Mac produced
 *         C:\Users\jo\AppData\Roaming\AgentWorkforce   <- what Windows produces
 *
 * ⚠️ THE RUNTIME WAS NEVER WRONG. On Windows the ambient `path` is `path.win32`,
 * so a real Windows machine always got the right answer. What was wrong was the
 * EVIDENCE: a function built to make Windows assertable from here returned a value
 * Windows never produces, and fifteen substring assertions could not tell.
 *
 * ⭐ A SUBSTRING MATCHER CANNOT DISTINGUISH THE RIGHT ANSWER FROM A NEARBY WRONG
 * ONE, WHICH IS PRECISELY THE DISTINCTION A GUARD EXISTS TO MAKE. The test now
 * pins whole strings.
 *
 * 📌 This is identical to the ambient `path` on the platform it names, so nothing
 * about a running install changes. It only makes the other platform's answer
 * truthful when asked from here.
 */
function joinerFor(platform) { return platform === 'win32' ? path.win32 : path.posix; }

function dataRootFor(platform, home, env) {
  const e = env || {};
  const p = joinerFor(platform);
  if (e.AGENT_WORKFORCE_DATA) return p.join(e.AGENT_WORKFORCE_DATA, APP);
  if (platform === 'win32') {
    /* ROAMING, not Local: this is a person's own configuration and it should
       follow them to another machine on a domain. `APPDATA` is set on every
       supported Windows, and the fallback is its documented location rather
       than a guess. */
    return p.join(e.APPDATA || p.join(home, 'AppData', 'Roaming'), APP);
  }
  return p.join(home, 'Library', 'Application Support', APP);
}

// ⚠️ Honours `AGENT_WORKFORCE_DATA` so tests can sandbox it, which they could
// not before: `status.test.js` set that variable, commented that it stopped
// `readProfile` and `avatarPath` reaching the operator's real store, and was
// wrong -- this module read no environment at all, so those calls went to the
// live store and the gates that depend on them could not be pinned against
// seeded data.
/**
 * The three paths, RESOLVED PER CALL rather than at require time (#1443).
 *
 * 🛑 THEY WERE CONSTANTS AND THAT MADE THE SANDBOX SEAM A LIE. Measured, both
 * arms: with `AGENT_WORKFORCE_DATA` set AFTER this module was required,
 * `store.ROOT` still answered the operator's real Application Support
 * directory. Every fixture that sets the variable at the top of its file was
 * fine; every one that sets it inside a `before`, a helper, or after any other
 * module had already pulled `store` in, was writing to the real machine while
 * believing it was sandboxed.
 *
 * ⚠️ AND THE DERIVED TWO ARE THE HALF THAT IS EASY TO MISS. Making `ROOT` lazy
 * and leaving `AVATARS`/`PROFILES` as `path.join(ROOT, ...)` at module level
 * would re-freeze it one line down, and the fix would LOOK done.
 */
function root() { return dataRootFor(process.platform, os.homedir(), process.env); }
function avatarsDir() { return path.join(root(), 'avatars'); }
function profilesDir() { return path.join(root(), 'profiles'); }

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Agent names come from tmux session names and end up in file paths, so they
 * are treated as untrusted. A name containing `../` would otherwise write
 * outside the store entirely.
 */
function safeKey(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!key) throw new Error('invalid agent name');
  return key;
}

const ALLOWED_IMAGES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function avatarPath(name) {
  const key = safeKey(name);
  try {
    for (const f of fs.readdirSync(avatarsDir())) {
      if (f.startsWith(key + '.')) return path.join(avatarsDir(), f);
    }
  } catch { /* no avatars yet */ }
  return null;
}

/**
 * What an image ACTUALLY is, read from its first bytes.
 *
 * 🛑 THE TYPE USED TO COME FROM THE BROWSER AND THAT FAILED BOTH WAYS. The page
 * sends `file.type`, which a browser derives from the FILENAME, so a perfectly
 * good PNG with no extension or one the OS does not recognise arrives with an
 * empty content-type and was refused: "unsupported image type: unknown", on a
 * file that would have rendered fine. That is the whole of #12, and it is what
 * makes #181 look broken the first time somebody sets their own picture.
 *
 * 🔑 AND IT IS THE SAME RULE AS EVERY OTHER TRUST DECISION IN HERE: prefer the
 * thing over a claim about the thing. The bytes cannot be wrong about what they
 * are; a header supplied by the caller can be wrong in either direction, and
 * one of those directions is refusing something valid while the other is
 * accepting something that is not an image at all.
 *
 * ⚠️ SIGNATURES ONLY, NOT A DECODER. This says "these bytes begin like a PNG",
 * which is exactly enough to choose a file extension and to refuse a text file
 * claiming to be one. It does not say the image is well formed, and it is not
 * trying to: a truncated PNG is still a PNG, and the page showing a broken
 * image is a better outcome than this file pretending to validate one.
 *
 * @returns {string|null} one of the ALLOWED_IMAGES keys, or null
 */
function imageTypeOf(buffer) {
  if (!buffer || !buffer.length) return null;
  const b = buffer;
  /* ⚠️ EACH FORMAT IS GUARDED BY THE LENGTH IT ACTUALLY NEEDS. A blanket
     minimum of 12 (WEBP's, the longest) refused an 8-byte PNG signature, which
     is a real thing to be handed: the suite's own fixtures are exactly that,
     and a truncated upload is too. Refusing it is not wrong about the file, it
     is wrong about WHY, and "that has to be a PNG" is a bad sentence to show
     somebody holding a PNG. */
  // PNG: the 8-byte signature, which includes the CRLF/EOF pair that exists to
  // catch exactly the transfer corruption we would otherwise store.
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  // JPEG: SOI, then any marker.
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a.
  if (b.length >= 6 && (b.slice(0, 6).toString('latin1') === 'GIF87a' || b.slice(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  // WEBP is a RIFF container: "RIFF" then four size bytes then "WEBP". The
  // size bytes are skipped rather than checked, because a wrong length is a
  // broken file rather than a different format.
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function saveAvatar(name, contentType, buffer) {
  if (!buffer || !buffer.length) throw new Error('empty file');
  /* ⚠️ EMPTY AND OVERSIZE FIRST, and the order is the message. Sniffing a 6MB
     PNG says "not an image" only if you sniff junk; sniffing FIRST would tell
     somebody with a large photo that it is not a PNG, which is false and sends
     them looking for the wrong problem. */
  if (buffer.length > 5 * 1024 * 1024) throw new Error('image is larger than 5MB');
  /* 🔑 THE BYTES DECIDE, and `contentType` is now only a hint for the sentence.
     It used to decide, which refused a valid PNG whose browser-guessed type
     was empty and accepted anything at all that claimed to be one. */
  const sniffed = imageTypeOf(buffer);
  const ext = ALLOWED_IMAGES[sniffed];
  if (!ext) {
    /* The message names what we got where we can, because "unsupported image
       type: unknown" tells somebody nothing about what to do next. */
    throw new Error(contentType && !ALLOWED_IMAGES[contentType]
      ? `that has to be a PNG, JPEG, WebP or GIF, and this looks like ${contentType}`
      : 'that has to be a PNG, JPEG, WebP or GIF');
  }

  const key = safeKey(name);
  ensure(avatarsDir());
  // Replace rather than accumulate: one avatar per agent, and an old .png
  // left beside a new .jpg would win or lose by directory order.
  const existing = avatarPath(name);
  if (existing) fs.unlinkSync(existing);

  const dest = path.join(avatarsDir(), key + ext);
  fs.writeFileSync(dest, buffer);
  return dest;
}

function removeAvatar(name) {
  const existing = avatarPath(name);
  if (existing) fs.unlinkSync(existing);
  return Boolean(existing);
}

/**
 * Profile: the things a person sets that the machine cannot derive.
 *
 * Role is the clearest example — nothing on this machine records what an agent
 * *is*. It is new metadata the user supplies, and it is what makes "Project
 * Manager" mean something the product can act on later.
 */
function profilePath(name) {
  return path.join(profilesDir(), safeKey(name) + '.json');
}

function readProfile(name) {
  try {
    return JSON.parse(fs.readFileSync(profilePath(name), 'utf8'));
  } catch {
    return {};
  }
}

function writeProfile(name, patch) {
  ensure(profilesDir());
  const had = readProfile(name);
  const next = { ...had, ...patch, updatedAt: new Date().toISOString() };
  /**
   * The agent's identity (#170): a random id minted ON THE FIRST WRITE and
   * never rewritten, so creation and the lazy backfill of existing agents
   * are one code path rather than two that can disagree. Random and not
   * derived, per the card: anything derived rekeys when its source changes,
   * and the whole point is an anchor that survives renames.
   *
   * ⚠️ A PATCH CANNOT TOUCH IDENTITY. `id` and `idInstall` are restored
   * from the existing record before the stamp runs, so no caller can set,
   * clear, or transplant an id through this door.
   *
   * ⚠️ AN ID MINTED UNDER ANOTHER INSTALL IS REMINTED, and this is the
   * decided restore semantics, not housekeeping: a restored agent is a
   * SEPARATE agent with its own fresh id (Josh ruled the screen, 19:26:
   * nobody is ever asked same-or-copy; the mechanism that needs no warning
   * is fresh id). The install id is the created ping's, the same one-Mac-
   * one-install anchor notify.js already reuses. Its known limit rides
   * along: on a machine whose ping file cannot be written, installId is
   * fresh per process and ids would remint per restart -- which degrades
   * in the SAFE direction (a new id is a separate agent, never a warning).
   */
  next.id = had.id;
  next.idInstall = had.idInstall;
  const install = require('./ping').installId();
  if (!next.id || next.idInstall !== install) {
    next.id = crypto.randomBytes(6).toString('hex');
    next.idInstall = install;
  }
  // Write-then-rename, so an interrupted write cannot leave a half-written
  // file that parses as an empty profile and silently loses someone's edits.
  const tmp = profilePath(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, profilePath(name));
  return next;
}

/**
 * The id the BOARD may speak (#170): the profile's id, but only when it was
 * minted under THIS install. A profile copied in from another machine
 * carries that machine's agent's id, and answering with it would name a
 * different agent; null here means "no identity yet", which the first
 * local write resolves by minting fresh. Read-only, no side effects: a
 * poll must never write.
 */
function agentId(name) {
  const p = readProfile(name);
  return (p.id && p.idInstall === require('./ping').installId()) ? p.id : null;
}

/**
 * Account-level settings (#1668), NOT keyed by agent: one operator, one install.
 * A single settings.json in the data root, with the same write-then-rename
 * durability as writeProfile so an interrupted write cannot leave a half-file
 * that parses empty and silently drops the operator's choices. The operator's
 * timezone lives here so the engine can READ it when it composes a message,
 * rather than every agent having to carry it as an instruction.
 */
function settingsPath() {
  return path.join(root(), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  ensure(root());
  const had = readSettings();
  const next = { ...had, ...patch, updatedAt: new Date().toISOString() };
  const tmp = settingsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, settingsPath());
  return next;
}

/**
 * ⚠️ `profilePath` is NOT exported, and the reason belongs here because this
 * branch exported it and then justified it by saying it had no caller.
 *
 * It was needed for an earlier design in which removing an agent DELETED what
 * this module remembers about it. That design is gone: removing an agent now
 * deletes nothing at all, on purpose, which is what makes it reversible — so a
 * profile deliberately survives its agent's removal and is there again when the
 * agent is restored. Nothing outside this file needs the path, so nothing gets
 * it. A symbol whose only justification is symmetry is a symbol somebody will
 * eventually use for the deletion this feature exists not to do.
 */
module.exports = { dataRootFor, safeKey, ALLOWED_IMAGES, imageTypeOf, avatarPath, saveAvatar, removeAvatar, readProfile, writeProfile, agentId, readSettings, writeSettings };

/* 🔑 GETTERS, SO 94 REFERENCES ACROSS 39 FILES KEEP WORKING UNCHANGED (#1443).
   `store.ROOT` still reads like a constant at every call site and now answers
   the CURRENT environment instead of the one that happened to be set when some
   other module first required this one.
   ⚠️ ENUMERABLE, so `{...store}` and `Object.keys` behave as they did. A
   non-enumerable getter would be a silent behaviour change in whatever spreads
   this object. */
for (const [name, fn] of [['ROOT', root], ['AVATARS', avatarsDir], ['PROFILES', profilesDir]]) {
  Object.defineProperty(module.exports, name, { get: fn, enumerable: true, configurable: true });
}
