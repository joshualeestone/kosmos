'use strict';

/**
 * #5050 (the agent side of "Kosmos in other languages"): one managed block that names the person's language, so an
 * agent starts and posts in it.
 *
 * April measured it (#5050, 2026-10-02, Claude Sonnet with a real instruction file loaded): an agent whose first input
 * is one of Kosmos's English notices answers in English (2/2); the same agent with ONE line naming the person's
 * language answers, and drafts its room post, in that language (4/4, the line at the top or the end of the file).
 * Agents already follow a person who writes first; what they did not do is START in the person's language, because
 * Kosmos's own first words to them are English. So this block is the whole fix for that, and the ~7,500 words of
 * Kosmos instructions stay in English.
 *
 * The language comes from this computer's setting: on a Mac the first preferred language (`defaults read -g
 * AppleLanguages`), the person's choice in Settings (#5080, agent-language.json, which comes before the Mac's setting
 * on every platform), or the AGENT_WORKFORCE_PERSON_LOCALE override (the test runners set it to en). A sure read (any of
 * those three) is kept for the process until the choice changes; a failed one is retried after FALLBACK_MS (5 minutes).
 * Only those three act. Node's Intl locale is the only other source, and it is ICU's user locale (the REGION setting on
 * Windows, LANG on Linux), not the display language, so it neither adds a block nor removes one the computer's setting
 * wrote: off a Mac, and on a Mac whose read failed, such a file is left exactly as it is. A sure English read writes no
 * block and removes one an agent already has. The one exception (#5080): with Automatic chosen and no sure read, a block
 * that names Settings as its source is out of date, and is removed.
 *
 * Where it sits: appended at the end when it is missing, then replaced where it is; never moved. Measured: end and top
 * of the file 2/2 each (April), and at 64% of a 7,670-word file 2/2 (10-02), so no position depends on where it sits.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const projects = require('./projects');
const instructions = require('./instructions');
const store = require('./store');

const START = projects.LANGUAGE_START;
const END = projects.LANGUAGE_END;
const WROTE_WHY = 'the person\'s language, from this computer\'s language setting (#5050)';
const WROTE_WHY_SETTINGS = 'the language the person chose in Settings (#5080)';
/* The words that mark a block written from the person's choice (blockBody's bracketed source for 'settings'). */
const SETTINGS_SOURCE = 'chosen in Kosmos Settings';
/* Review 6: the block's own sentence, not the phrase anywhere in it, marks a block a choice wrote. */
const STALE_SETTINGS_LINE = new RegExp('^The person who runs this computer reads [^\\n]+ \\([A-Za-z0-9-]+, ' + SETTINGS_SOURCE + '\\)\\. Write to them', 'm');

/* #5080: the person's choice in Settings ("The language your agents write to you in"). Its own file through the one
   data-root derivation, so a test data root isolates it. No file is Automatic (the computer's setting, as before). */
const CHOICE_FILE = path.join(store.ROOT, 'agent-language.json');
/* The fixed list the picker offers. Only Spanish and Portuguese were measured (#5050), in the variants #5050 named;
   Automatic still covers any other language a Mac is set to, exactly as before the picker. */
const CHOICES = [
  { tag: 'en', name: 'English' },
  { tag: 'es-419', name: 'Spanish (Latin America)' },
  { tag: 'pt-BR', name: 'Portuguese (Brazil)' },
];
const AUTO = 'auto';

/* The stored choice: `{ choice, ok }`. No file: Automatic. A file that cannot be read, or holds anything but a choice
   on the list, is `ok: false`, and read() then treats the language as not sure (nothing changes): Automatic in its place
   could put back a block the person turned off with English. */
function readChoice() {
  let raw;
  try { raw = fs.readFileSync(CHOICE_FILE, 'utf8'); }
  // `none`: no choice was ever saved, so no block in any file can be one a choice wrote (review 6: the boot sweep then
  // reads no files off a Mac, as before the picker).
  catch (err) { return err && err.code === 'ENOENT' ? { choice: AUTO, ok: true, none: true } : { choice: null, ok: false }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { choice: null, ok: false }; }
  const c = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.choice : undefined;
  if (c === AUTO || CHOICES.some((x) => x.tag === c)) return { choice: c, ok: true };
  return { choice: null, ok: false };
}

/** Save the person's choice (`auto` or a tag on the list). The process's cached read is dropped, so the next read uses it. */
function setChoice(choice) {
  if (choice !== AUTO && !CHOICES.some((x) => x.tag === choice)) return { ok: false, code: 'invalid', because: 'that is not one of the languages Kosmos offers' };
  try {
    fs.mkdirSync(path.dirname(CHOICE_FILE), { recursive: true });
    store.saveFlushed(CHOICE_FILE, JSON.stringify({ choice }) + '\n');
  } catch {
    return { ok: false, code: 'io', because: 'we could not save that setting' };
  }
  return { ok: true };   // the next read sees the new choice (read() keys its cache on it)
}

/* A BCP 47 tag, or null. Accepts the Mac's spellings too ("es_MX", "zh-Hans-CN"). */
function normalise(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/_/g, '-').replace(/\..*$/, '').replace(/@.*$/, '');
  if (!s || s === 'C' || s === 'POSIX' || /^und(-|$)/i.test(s)) return null;
  try { return Intl.getCanonicalLocales(s)[0] || null; } catch { return null; }
}

/* The Mac's first preferred language, or null. `defaults` prints a plist array: ( "es-MX", "en-US" ). */
function macPreferred(run) {
  try {
    const out = (run || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })))('/usr/bin/defaults', ['read', '-g', 'AppleLanguages']);   // absolute, as machine.js does: never whatever is first on PATH
    // The FIRST element of the array only (review 8): an entry that does not parse is not sure, never the second one.
    const first = String(out).replace(/^\s*\(\s*/, '').split(/[,)\n]/)[0].trim().replace(/^"|"$/g, '');
    return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/.test(first) ? normalise(first) : null;
  } catch { return null; }
}

/**
 * The person's locale and how it was read: `{ tag, sure }`. The override and a Mac's `defaults` answer are sure;
 * Node's Intl locale is a fallback (the region setting on Windows, LANG elsewhere, or a Mac whose `defaults` read failed
 * or timed out), and a fallback changes nothing: one bad read at a busy boot must not strip every agent's block, and a
 * region setting must not put agents into a language the person does not read. `o` is a test seam
 * ({ env, platform, run, intl }); production passes nothing.
 */
let source = null;   // test seam: what the no-argument read reads (production: the real machine)
let cached;   // a SURE read is kept for the process (a language changed while the board runs reaches new agents at
              // the next board start); a fallback is read again once FALLBACK_MS has passed
let fallbackAt = 0;
const FALLBACK_MS = 5 * 60 * 1000;   // review 4: a hanging `defaults` (2 s timeout, synchronous: it blocks the whole board's
                                     // event loop) is asked at most once per window, not on every create
let cachedChoice;   // review 4 (#5080): the stored choice the cached read was made with; the file is read on every
                    // call (small, local), so a choice saved by anything but setChoice is not hidden behind the cache
function read(o) {
  if (!o) {
    const picked = source && source.choice !== undefined ? source.choice : readChoice();
    const key = JSON.stringify(picked);
    if (cached !== undefined && cachedChoice === key && (cached.sure || Date.now() - fallbackAt < FALLBACK_MS)) return cached;
    // Review 5: Automatic chosen again reuses what Automatic last read, so a save does not ask a hanging `defaults` anew.
    const autoFresh = picked.ok && picked.choice === AUTO && autoCached !== undefined
      && (autoCached.sure || Date.now() - autoAt < FALLBACK_MS);
    const got = autoFresh ? withAutoMark(autoCached, picked) : read({ ...(source || {}), choice: picked });
    cached = got; cachedChoice = key; fallbackAt = got.sure ? 0 : Date.now();
    // With Automatic chosen this IS what Automatic reads, so the Settings page does not ask `defaults` a second time.
    if (picked.ok && picked.choice === AUTO && !autoFresh) { autoCached = got; autoAt = fallbackAt; }
    return got;
  }
  const opts = o;
  const env = opts.env || process.env;
  // A 2 or 3 letter language subtag, as the Mac read requires: BCP 47 also allows 5 to 8 letters, so "english" would be
  // a (wrong) tag that reads as a sure non-English language (review 11).
  const forcedRaw = normalise(env.AGENT_WORKFORCE_PERSON_LOCALE);
  const forced = forcedRaw && /^[a-z]{2,3}(-|$)/i.test(forcedRaw) ? forcedRaw : null;
  if (forced) return { tag: forced, sure: true, from: 'computer' };
  // #5080: the person's choice in Settings comes before the computer's setting, on every platform. One that cannot be
  // read is not sure: nothing changes (see readChoice). `o.choice` is the test seam for the stored choice.
  const picked = opts.choice !== undefined ? opts.choice : readChoice();
  if (!picked.ok) return { tag: null, sure: false, from: 'settings' };
  if (picked.choice !== AUTO) return { tag: picked.choice, sure: true, from: 'settings' };
  if ((opts.platform || process.platform) === 'darwin') {
    const mac = macPreferred(opts.run);
    if (mac) return { tag: mac, sure: true, from: 'computer' };
  }
  let tag = null;
  try { tag = normalise(opts.intl !== undefined ? opts.intl : Intl.DateTimeFormat().resolvedOptions().locale); } catch { tag = null; }
  // `auto`: Automatic was read from the file, so a block that names Settings as its source is known to be stale.
  return picked.none ? { tag, sure: false, from: 'computer' } : { tag, sure: false, from: 'computer', auto: true };
}
/* A reused Automatic read, with its `auto` mark (take out a stale Settings block) from the choice as it is now: a saved
   Automatic carries it, Automatic with no choice ever saved does not. A sure read carries none either way. */
function withAutoMark(got, picked) {
  if (got.sure) return got;
  const rest = { ...got };
  delete rest.auto;
  return picked.none ? rest : { ...rest, auto: true };
}
/* #5080: what Automatic reads on this computer, whatever the stored choice (the picker shows it beside Automatic). Kept
   the way read() keeps its answer, so opening Settings does not ask a hanging `defaults` each time (review 4). */
let autoCached;
let autoAt = 0;
function automatic() {
  if (autoCached !== undefined && (autoCached.sure || Date.now() - autoAt < FALLBACK_MS)) return autoCached;
  const got = read({ ...(source || {}), choice: { choice: AUTO, ok: true } });
  autoCached = got; autoAt = got.sure ? 0 : Date.now();
  return got;
}
/** The person's locale (the tag alone). */
function detect(o) { return read(o).tag; }

/* English (any region), unknown, or unreadable: no block. */
function isEnglish(tag) {
  return !tag || /^en(-|$)/i.test(tag);
}

/* The language's name in English ("Spanish"), or the tag itself when the runtime has no name for it. */
function languageName(tag) {
  try {
    // Language plus script, never the region (review 19): zh-Hant is "Traditional Chinese", not "Chinese", since the
    // script decides what the person can read; the region (es-MX) only changes the tag beside the name.
    const loc = new Intl.Locale(tag);
    // Chinese with no script in the tag (zh-HK, zh-TW, zh-MO, as Apple writes them): infer it, so Hong Kong and Taiwan
    // read "Traditional Chinese" (review 21). Only for Chinese: maximize() would turn "es" into "Spanish (Latin)".
    const script = loc.script || (loc.language === 'zh' ? loc.maximize().script : undefined);
    const base = script ? `${loc.language}-${script}` : loc.language;
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(base);
    return name && name !== base ? name : tag;
  } catch { return tag; }
}

/** The block's words for this locale, or null for English (no block). `from` is 'settings' for the person's choice. */
function blockBody(tag, from) {
  if (isEnglish(tag)) return null;
  const name = languageName(tag);
  // #5080: only the source in brackets differs for a choice made in Settings; the computer's wording is byte-identical.
  const source = from === 'settings' ? SETTINGS_SOURCE : 'from this computer\'s language setting';
  /* April's tested variant A word for word (appended at the end of the file: Spanish 2/2 against English 2/2 with no
     block), plus the one sentence she carried over from variant B, which names the confusion the test exposed. */
  return [
    '## The person\'s language',
    '',
    `The person who runs this computer reads ${name} (${tag}, ${source}). Write to them, and in your project rooms, in ${name} unless they write to you in another language. Kosmos itself talks to you in English; that is not the person's language.`,
    /* #5050 follow-up (Renet, 2026-10-03): the community is one shared English channel, and #5108's bug triage groups
       --kosmos-bug reports by the words in their titles, so a report in another language would neither group nor
       match a card. Measured before shipping (see the plan). Review 1: comments and replies too, and only if the agent
       writes there at all (an agent outside the community has no community instructions). */
    'If you write on the Kosmos+ community, write in English: posts, comments, replies and Kosmos bug reports alike, even when what you answer is in another language, so every agent and the people who read it can follow.'
  ].join('\n');
}

/** #5080: whether `text` holds exactly one language block, and it is one an earlier choice in Settings wrote. Automatic
    with no sure read takes such a block out (at create, in the sweeps); any other block is left as it is. */
function hasStaleSettingsBlock(text) {
  const one = projects.findBlock(String(text == null ? '' : text), START, END);
  return Boolean(one && !one.ambiguous && STALE_SETTINGS_LINE.test(String(text).slice(one.start, one.end)));
}

/** `text` with the block for `tag` at its end, or without the block when the language is English. */
function applyTo(text, tag, from) {
  const body = blockBody(tag, from);
  const str = String(text == null ? '' : text);
  if (!body) {
    const at0 = projects.findBlock(str, START, END);
    // With the person's (or anyone's) text after it, cut exactly the block and keep one blank line between what remains
    // (review 11: removeBlock joins the paragraphs across the gap). Last in the file: removeBlock, byte for byte.
    if (at0 && !at0.ambiguous && str.slice(at0.end).trim()) return cutOut(str, at0);
    return projects.removeBlock(str, START, END);
  }
  /* Replaced where it sits, or appended when missing; never moved (review 15). Every measured position held (end, top,
     64%), so a move would only rewrite the file, rotate the person's one-deep undo and prompt a restart for nothing.
     Byte-equal when nothing changed, so no write. Two blocks: spliceBlock returns the text unchanged. */
  return projects.spliceBlock(str, body, START, END);
}

/* `str` without the block at `at`, what was before and after it rejoined with one blank line in the file's own line
   ending. Only line breaks at the seam are trimmed; everything after the block, its end included, stays as written. */
function cutOut(str, at) {
  const eol = str.includes('\r\n') ? '\r\n' : '\n';   // the file's own line ending, as dmfiles.spliceTop keeps it (review 21)
  const before = str.slice(0, at.start).replace(/(\r?\n)+$/, '');
  const rest = str.slice(at.end).replace(/^(\r?\n)+/, '');   // the text after it is otherwise left exactly as it was
  if (!rest) return before ? before + eol : '';
  return before ? before + eol + eol + rest : rest;
}


/* Whether anything (a file, a link, a folder) is at `p`; lstat, so a dangling link counts as something. */
function somethingAt(p) {
  if (!p) return false;
  try { require('node:fs').lstatSync(p); return true; } catch { return false; }
}

/** Put the block in (or take it out of) one agent's instructions. connections.tellAgent's guards, minus its bypass. */
function tellAgent(sessionName, roster, opts) {
  try {
    if (!projects.heldExactly(sessionName, roster)) {   // no "trusted" bypass: nothing here needs one (review 13)
      return {
        state: projects.TOLD.COULD_NOT,
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const got = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? { tag: opts.tag, sure: opts.sure !== false, from: opts.from, auto: opts.auto } : read();
    // Nothing to do (a read that is not sure changes nothing): told, without touching the file (review 4: no boot noise).
    if (!got.sure && !got.auto) return { state: projects.TOLD.TOLD, because: null, changed: false };
    const current = instructions.read(sessionName);
    // Nothing at the instructions path (no file, or no folder at all, as for an agent with no worker folder): this module
    // never creates one, so there is nothing to change and nothing to report, in any language (review 14). Something
    // there that cannot be read safely is not that: it is reported, as connections.tellAgent does (review 15).
    if (!current.exists && !somethingAt(current.path)) return { state: projects.TOLD.TOLD, because: null, changed: false };
    // #5080: Automatic with no sure read only ever takes out a block an earlier choice in Settings wrote. A file it cannot
    // read, or one with two blocks, is left exactly as it is and reported as nothing to do, as before the picker (no boot
    // noise on every Windows and Linux start).
    if (!got.sure && !(current.exists && hasStaleSettingsBlock(current.text || ''))) {
      return { state: projects.TOLD.TOLD, because: null, changed: false };
    }
    if (!current.exists) return { state: projects.TOLD.COULD_NOT, because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    const found = projects.findBlock(current.text || '', START, END);
    if (found && found.ambiguous) {
      return {
        state: projects.TOLD.COULD_NOT,
        because: `its instructions contain ${found.pairs} Kosmos language blocks, so we cannot tell which is ours and did not change anything`,
      };
    }
    // Sure: the block for the language read. Not sure (only reached for a stale Settings block, above): no block.
    const next = got.sure ? applyTo(current.text || '', got.tag, got.from) : applyTo(current.text || '', null);
    if (next === current.text) return { state: projects.TOLD.TOLD, because: null, changed: false };
    instructions.write(sessionName, next, current.version, undefined, { who: 'kosmos', because: got.from === 'settings' || !got.sure ? WROTE_WHY_SETTINGS : WROTE_WHY });   // not sure: a Settings block taken out
    // kosmos#5304: changed owes the running agent a re-read; a removal (English again) owes none (instructionreread.oweEach).
    return { state: projects.TOLD.TOLD, because: null, changed: true, removed: !projects.findBlock(next, START, END) };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: projects.TOLD.COULD_NOT,
      because: /larger than an instruction file should be/.test(raw)
        ? 'its instructions are already at the size limit'
        : (raw || 'we could not write to its instructions'),
    };
  }
}

/** Every agent the board can name as ours; the language is read once for the whole sweep. */
function syncEveryone(roster, opts) {
  if (!Array.isArray(roster)) {
    return [{ agent: null, state: projects.TOLD.COULD_NOT, because: 'we could not check which agents are running' }];
  }
  const got = opts && Object.prototype.hasOwnProperty.call(opts, 'tag') ? { tag: opts.tag, sure: opts.sure !== false, from: opts.from, auto: opts.auto } : read();
  const told = [];
  for (const a of roster) {
    if (!a || !a.sessionName || a.isNamedOurs !== true) continue;
    told.push({ agent: a.sessionName, ...tellAgent(a.sessionName, roster, { tag: got.tag, sure: got.sure, from: got.from, auto: got.auto }) });
  }
  return told;
}

module.exports = { _resetForTests: (src) => { cached = undefined; cachedChoice = undefined; fallbackAt = 0; autoCached = undefined; autoAt = 0; source = src || null; }, _ageFallbackForTests: () => { fallbackAt -= FALLBACK_MS; autoAt -= FALLBACK_MS; }, START, END, SETTINGS_SOURCE, CHOICE_FILE, CHOICES, AUTO, readChoice, setChoice, automatic, hasStaleSettingsBlock, normalise, macPreferred, read, detect, isEnglish, languageName, blockBody, applyTo, tellAgent, syncEveryone };
