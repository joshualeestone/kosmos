'use strict';

/**
 * The refresh of the working rules (#539): what changes the rules Kosmos wrote into an instruction file the person
 * owns, composed here and NOWHERE ELSE.
 *
 * The constraint the whole card hangs on (Mona Lisa's, on the card): role text is PERSON-OWNED after creation and
 * deliberately never rewritten. Two writers, and only two:
 *   - the person's CLICK (refresh), the same act as pasting the sections in themselves with Kosmos holding the pen;
 *   - kosmos#5635, with NO click (refreshUnedited, at board start): only where the rules text is, byte for byte, a
 *     WHOLE earlier block Kosmos wrote (a span holding one exactly, or an unedited plain copy). Text that is Kosmos's
 *     own and unchanged is not the person's words, so bringing it current takes none of theirs. Josh's 2026-10-07
 *     feedback found every agent still on a line fixed five days before, because the click never came.
 * Anything else that writes without the click (a span with a section removed, reordered or reworded, a file with no
 * rules block, an agent whose person said Not now), or that touches a byte outside the managed span, breaks the
 * ownership rule for real and should be reverted on sight.
 *
 * Built to Angel's nine constraints (2026-08-24, read from the code, on
 * the card's thread), each carried where it bites:
 *
 *   1/7  the marker pair is CONSTANT, defined in projects.js and in
 *        ALL_MARKERS(), so neutralise() knows it and findBlock can find
 *        the span forever (a dated marker could never be re-found, and the
 *        next refresh would append a second block);
 *   2    nothing user-derived enters the span -- every byte is defaults.js's
 *        own text plus Mona Lisa's sentences -- so there is nothing to
 *        neutralise, which is stated rather than discovered;
 *   3    ONE composition, two readers: the dialog shows what planFor
 *        composed and the click writes THAT file text, proven by hash;
 *   4    a true no-op never writes: nothing-missing composes nothing, and
 *        an up-to-date span is detected on its SECTION CONTENT before any
 *        dated sentence is composed, so a byte never moves for a date;
 *   5    ambiguity refuses with a reason and never reports success on an
 *        unchanged return;
 *   6    everything outside the markers is untouched because the only
 *        writer is projects.spliceBlock; no hand edits anywhere, EXCEPT
 *        (#4890) an unedited plain copy of an earlier block, which is
 *        Kosmos's own text: it is cut out byte for byte (pastBlockIn);
 *   8    presence is per-section by HEADING across the WHOLE file, managed
 *        or not: an old agent carrying the doctrine as plain text appends
 *        NOTHING, unless (#4890) that text is an unedited earlier block,
 *        which is offered the current rules in its place;
 *   9    section text comes from defaults.js's one source (#629), so a
 *        refreshed block byte-matches what a fresh birth writes.
 */

const crypto = require('node:crypto');
const defaults = require('./defaults');
const projects = require('./projects');
const instructions = require('./instructions');
const store = require('./store');
const PAST = require('./doctrine-past');

const START = projects.DOCTRINE_START;
const END = projects.DOCTRINE_END;

/** The click-day date, in the plain form Mona Lisa's sentence carries. */
function clickDate(now) {
  const d = now instanceof Date ? now : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/* Mona Lisa's sentences (her ruling): the dated one is the FIRST line inside the constant markers, never the marker
   itself. Her "Kosmos may update this block" became, in kosmos#5635, what Kosmos now does (KEEPS below), and it is
   TRUE: an unedited span is recomposed at board start, an edited one only through the click. */
/* kosmos#5635: every frame line says what Kosmos now does with the block: keeps it current by itself while nobody has
   edited it, and asks first once somebody has. Each starts with the words sectionContentOf strips. */
const KEEPS = 'Kosmos keeps this block up to date when the rules change while it is exactly as Kosmos wrote it, and asks first otherwise; your own words above and below it are never touched.';
function openingLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, with your OK. ${KEEPS} -->`;
}
/* kosmos#5635: the frame of a refresh nobody clicked (refreshUnedited), so the file never claims an OK nobody gave. */
function autoLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, bringing its own earlier copy up to date. ${KEEPS} -->`;
}
const CLOSING_LINE = '<!-- end of the working rules -->';
/* kosmos#5635 review 2: every frame line Kosmos has ever written, exactly (the date varies). sectionContentOf drops ANY
   line with the frame's prefix, so a person's words added inside that comment would read as frame; the write with no
   click requires each such line to be one of these. */
const FRAME_TAILS = [
  'with your OK. Kosmos may update this block when the rules change; your own words above and below it are never touched.',
  'when it set up this agent. Kosmos may update this block when the rules change, with your OK; your own words above and below it are never touched.',
  'with your OK. ' + KEEPS, 'when it set up this agent. ' + KEEPS, 'bringing its own earlier copy up to date. ' + KEEPS,
];
function isKosmosFrame(line) {
  const m = /^<!-- Kosmos added the working rules below on \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}, (.*) -->$/.exec(line);
  return !!m && FRAME_TAILS.includes(m[1]);
}
/* #4890: the same frame at birth, where nobody clicked. It starts with the words sectionContentOf strips, so a
   refresh compares the rules and never this line. */
function birthLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, when it set up this agent. ${KEEPS} -->`;
}

/** The span body for a given set of sections, dated the day of the click (or of the birth, given `opening`). */
function spanBody(sectionsList, now, opening) {
  return [opening || openingLine(now), '', sectionsList.map((s) => s.text).join('\n'), '', CLOSING_LINE].join('\n');
}

/**
 * #4890: the working rules as an agent is BORN with them, inside the managed span, so a later change under an
 * existing heading reaches it through the consented refresh. Before this, birth wrote them as plain text
 * (defaults.appendTo) and planFor can offer a plain file only the headings it lacks, so such a change reached
 * new agents only. The cases:
 *   - text holding a doctrine marker already (pasted from another agent's file): the plain block, never a span
 *     spliced among markers it did not write;
 *   - text carrying today's block inline: framed in place at creation, left as it is on import (opts.frameInline);
 *   - text carrying the rules any other way: left as it is;
 *   - otherwise: the span, or the plain block where only that fits under `maxBytes`.
 */
function atBirth(text, now, maxBytes, opts) {
  const body = String(text == null ? '' : text);
  if (body.includes(START) || body.includes(END)) return defaults.appendTo(body);
  if (body.includes(defaults.RULES_PHRASE)) {
    // An imported file is the person's own: what it carries is left as it is (opts.frameInline false, discover.js).
    if (opts && opts.frameInline === false) return body;
    /* Today's block, byte for byte, inline (roles.js `own` and `setup` carry it) is framed in place. Anything else
       carrying the rules is left as it is. */
    const at = plainCurrentAt(body);
    if (at < 0) return body;
    const end = at + defaults.block().length;
    const framed = body.slice(0, at) + `${START}\n${spanBody(defaults.sections(), now, birthLine(now))}\n${END}` + body.slice(end);
    return maxBytes && Buffer.byteLength(framed, 'utf8') > maxBytes ? body : framed;
  }
  const spanned = projects.spliceBlock(body, spanBody(defaults.sections(), now, birthLine(now)), START, END);
  /* The frame costs a few hundred bytes. Where only the plain block fits under the caller's cap, the agent gets
     the plain block (as before #4890) rather than none. */
  if (maxBytes && Buffer.byteLength(spanned, 'utf8') > maxBytes) return defaults.appendTo(body);
  return spanned;
}

/** #4890: where today's block sits as plain text, at a line start and ending at a line end, or -1. */
function plainCurrentAt(body) {
  const current = defaults.block();
  for (let at = body.indexOf(current); at >= 0; at = body.indexOf(current, at + 1)) {
    const after = body[at + current.length];
    if ((at === 0 || body[at - 1] === '\n') && (after === undefined || after === '\n' || after === '\r')) return at;
  }
  return -1;
}
function hasPlainCurrent(body) {
  return plainCurrentAt(body) >= 0;
}

/* kosmos#5635: rules text that is, byte for byte, a WHOLE earlier block. The only span content refreshUnedited writes
   over: the per-section match below also accepts a span with a section deleted or the sections reordered (review 1),
   which is the person's edit and waits for the click. */
/* kosmos#5635 review 5: the profile as the no-click write must read it. store.readProfile answers {} for ANY failure,
   which would read a Not now and the restore record as absent and then let writeProfile replace the file (its id
   too). Only a profile that does not exist is empty; one that exists and cannot be read or parsed is null. */
function profileStrict(sessionName) {
  let raw;
  try { raw = require('node:fs').readFileSync(store.profilePath(sessionName), 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? {} : null; }
  try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; }
}
/* The hash of today's block, the record of which rules were last written into an agent's file (review 4). */
function currentBlockHash() {
  return crypto.createHash('sha256').update(defaults.block()).digest('hex');
}
function wholeKnownBlock(content, past) {
  const rows = past || PAST;
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  return rows.some((r) => r.length === content.length && sha(content) === r.sha256);
}
/* #4890: rules text Kosmos wrote and nobody changed: a whole earlier block, or (a span from an older click that
   added only the headings an agent lacked) sections that are each an earlier block's section, byte for byte. */
function knownContent(content, past) {
  const rows = past || PAST;
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  if (wholeKnownBlock(content, rows)) return true;
  const known = new Set(rows.sections || []);
  return known.size > 0 && content.split('\n### ').every((p, j) => known.has(sha(j === 0 ? p : '### ' + p)));
}

/**
 * #4890: where an unedited plain copy of an EARLIER block sits in this text, or null. "Unedited" is a byte match
 * against a fingerprint in doctrine-past.js, starting at the rules' first heading line and ending at a line end. The current block is in
 * that table too and is not reported here: a plain copy of today's rules has nothing to update.
 */
function pastBlockIn(body, past, skip) {
  const first = defaults.sections()[0].heading;
  const current = defaults.block();
  const rows = past || PAST;
  for (let at = body.indexOf(first); at >= 0; at = body.indexOf(first, at + 1)) {
    if (at > 0 && body[at - 1] !== '\n') continue;
    if (skip && at < skip.end && at >= skip.start) continue;   // earlier rules inside a span are the span path's
    if (body.startsWith(current, at)) continue;   // today's block, which an earlier one can be a prefix of
    for (const row of rows) {
      const slice = body.slice(at, at + row.length);
      if (slice.length !== row.length || slice === current) continue;
      const after = body[at + row.length];
      if (after !== undefined && after !== '\n' && after !== '\r') continue;   // words typed onto its last line are an edit
      // A later block only appended sections, so an earlier one can match as its prefix: a copy that goes on into
      // another section is not this one.
      if (/^(?:[ \t]*\r?\n)*### /.test(body.slice(at + row.length + 1))) continue;
      if (crypto.createHash('sha256').update(slice).digest('hex') === row.sha256) return { start: at, end: at + row.length, version: row.version };
    }
  }
  return null;
}

/** The section content of a span body, with the dated frame taken off, so
    up-to-date-ness is decided on the RULES, never on the date (constraint 4:
    a write that only re-dates the sentence is a write for nothing). */
function sectionContentOf(spanInner) {
  return String(spanInner == null ? '' : spanInner)
    .replace(/\r\n/g, '\n')   // #4890: a span saved with Windows line endings holds the same rules
    .split('\n')
    .filter((line) => !line.startsWith('<!-- Kosmos added the working rules below on ')
      && line !== CLOSING_LINE)
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * What a refresh would do to this text, composed ONCE. Pure. Returns:
 *   { state: 'could_not', because }                     ambiguity, refused
 *   { state: 'current' }                                nothing to add; NO write may follow
 *   { state: 'refresh', sections, spanNext, fileNext, hash, replacing?, updating? }
 *
 * `replacing` (#4890) is true when the write (a click, or refreshUnedited) also removes an unedited plain
 * copy of an earlier block; `updating` when it rewrites an existing span. `past` is the fingerprint table, for tests only;
 * engine/doctrine-past.js otherwise.
 *
 * `sections` is what the dialog lists; `fileNext` is what a click writes;
 * `hash` is how the click proves it consents to THIS composition and not a
 * file that changed since the dialog (the could-not arm of the race is an
 * honest "look again", never a write on a guess).
 */
function planFor(text, now, past, opening) {   // `opening`: the frame line (kosmos#5635), the click's by default
  const body = String(text == null ? '' : text);
  const found = projects.findBlock(body, START, END);
  if (found && found.ambiguous) {
    return { state: 'could_not', because: `its instructions contain ${found.pairs} Kosmos working-rules blocks, so we cannot tell which is ours and did not change anything` };
  }
  /* #4890: a plain copy of an EARLIER block, byte for byte, is Kosmos's own text that nobody edited, so the
     click may replace it with the current rules. Only a copy OUTSIDE any span counts: a span holds earlier
     rules too, and those are brought current by the span path below. */
  const old = pastBlockIn(body, past, found || null);
  if (old && !(found && old.start < found.end && old.end > found.start)) {
    const all = defaults.sections();
    const without = body.slice(0, old.start) + body.slice(old.end).replace(/^\r?\n/, '');
    /* The copy is cut and the rest planned again, when the rules also live somewhere else in the file: a span (a
       person who clicked an earlier refresh that added only missing headings), another earlier copy, or today's
       own plain copy. One click then leaves one copy of the current rules. */
    if (found || pastBlockIn(without, past) || hasPlainCurrent(without)) {
      const plan = planFor(without, now, past, opening);
      if (plan.state === 'refresh') return { ...plan, replacing: true, hash: hashOf(plan.fileNext) };
      if (plan.state === 'current') {
        const kept = all.filter((s) => without.includes(s.heading));
        return { state: 'refresh', replacing: true, sections: kept, spanNext: '', fileNext: without, hash: hashOf(without) };
      }
      return plan;
    }
    /* No span: the span takes the copy's place. A heading the person also carries outside it is theirs and is
       not written again (constraint 8, as the span path below does). */
    const outside = body.slice(0, old.start) + body.slice(old.end);
    const wanted = all.filter((s) => !outside.includes(s.heading));
    if (wanted.length) {
      const spanNext = spanBody(wanted, now, opening);
      const fileNext = body.slice(0, old.start) + `${START}\n${spanNext}\n${END}` + body.slice(old.end);
      return { state: 'refresh', replacing: true, sections: wanted, spanNext, fileNext, hash: hashOf(fileNext) };
    }
  }
  if (found) {
    /* An existing managed span: its sections are OURS to bring current;
       sections a person carries OUTSIDE the span are theirs and are never
       duplicated (whole-file heading presence decides "outside"). */
    /* ⚠️ THE READ BOUNDARY MATCHES THE WRITE BOUNDARY (Angel's review of
       #637): spliceBlock replaces to the FIRST end after start (found.end),
       so the span is read to exactly there. A lastIndexOf(END) here jumped
       to a stray END marker in the person's prose after the block, over-
       extended the read into their words, misclassified an up-to-date file
       as refresh (a write for a non-change, rotating their one-deep undo)
       and pulled prose headings into the composed block. The write was
       always bounded; the read now is too. */
    const spanInner = body.slice(body.indexOf('\n', found.start) + 1, found.end - END.length);
    const outside = body.slice(0, found.start) + body.slice(found.end);
    const wanted = defaults.sections().filter((s) => spanInner.includes(s.heading) || !outside.includes(s.heading));
    if (!wanted.length) return { state: 'current' };
    const wantedContent = wanted.map((s) => s.text).join('\n');
    if (sectionContentOf(spanInner) === wantedContent) return { state: 'current' };
    const spanNext = spanBody(wanted, now, opening);
    const fileNext = projects.spliceBlock(body, spanNext, START, END);
    /* #4890: a span that is not text Kosmos wrote (knownContent) is `edited`, which the fleet click leaves. */
    const known = knownContent(sectionContentOf(spanInner), past);
    return { state: 'refresh', updating: true, edited: !known, sections: wanted, spanNext, fileNext, hash: hashOf(fileNext) };
  }
  /* No span: an agent born with the doctrine as plain text, or born before
     it. Only genuinely absent sections are offered (constraint 8); a file
     carrying every section as the person's own text appends NOTHING. */
  const missing = defaults.missingFrom(body);
  if (!missing.length) return { state: 'current' };
  const spanNext = spanBody(missing, now, opening);
  const fileNext = projects.spliceBlock(body, spanNext, START, END);
  return { state: 'refresh', sections: missing, spanNext, fileNext, hash: hashOf(fileNext) };
}

function hashOf(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

/* #4890: an agent created or imported with the rules has them inside the span, so a span that differs at the
   version it already carries, and is not an earlier block (`edited`), differs because the PERSON changed it. status() raises no banner for it and the fleet click
   (refresh without the dialog's hash) leaves it; the next version offers the update as usual. */
function personEditedAtCarried(plan, carried) {
  return plan.state === 'refresh' && plan.updating === true && plan.edited === true && !plan.replacing
    && carried !== null && carried >= defaults.DOCTRINE_VERSION;
}

/**
 * What the banner and the dialog need for one agent, no write anywhere.
 */
function status(sessionName, now, past) {   // `past`: tests only
  const current = instructions.read(sessionName);
  if (!current.exists) {
    return { state: 'could_not', because: current.because || 'it has no instructions file yet' };
  }
  const plan = planFor(current.text || '', now, past);
  let profile = {};
  try { profile = store.readProfile(sessionName) || {}; } catch { profile = {}; }
  const carried = Number.isFinite(profile.doctrineVersion) ? profile.doctrineVersion : null;
  if (personEditedAtCarried(plan, carried)) {
    return { state: 'current', carried, currentVersion: defaults.DOCTRINE_VERSION, declined: profile.doctrineDeclined === defaults.DOCTRINE_VERSION };
  }
  return {
    ...plan,
    carried,
    currentVersion: defaults.DOCTRINE_VERSION,
    declined: profile.doctrineDeclined === defaults.DOCTRINE_VERSION,
  };
}

const FLEET_LEAVES_REPLACE = 'its older copy of the rules is replaced only from its own page, where the change is shown';
const FLEET_LEAVES_EDITED = 'its working rules are not a copy Kosmos recognises as its own, so they are updated only from its own page, where the change is shown';
/* #4890: why the fleet click (names only, no dialog hash) leaves this plan for the agent's own page, or null. The
   fleet list (server.js) reads the same answer, so the list and the click agree. */
function fleetLeaves(plan) {
  if (plan && plan.replacing) return FLEET_LEAVES_REPLACE;
  if (plan && plan.updating && plan.edited) return FLEET_LEAVES_EDITED;
  return null;
}
/**
 * The consented write, the reports.tellAgent shape: gate, read, plan,
 * refuse-or-write, and a verdict in a sentence. `expectHash` is the hash
 * the dialog showed; a file that changed since then refuses with "look
 * again" rather than writing a composition nobody saw.
 */
function refresh(sessionName, roster, opts) {
  try {
    const vouched = !!(opts && opts.trusted);
    if (!vouched && !projects.heldExactly(sessionName, roster)) {
      return {
        state: 'could_not',
        because: !Array.isArray(roster)
          ? 'we could not check which agents are running'
          : roster.some((a) => a && a.sessionName === sessionName)
            ? 'something is running under this name, but we cannot tell that it is this agent'
            : 'we could not find an agent with exactly this name on this computer',
      };
    }
    const current = instructions.read(sessionName);
    if (!current.exists && !current.editable) {
      return { state: 'could_not', because: current.because || 'it keeps its instructions somewhere we cannot safely change' };
    }
    if (!current.exists) {
      return { state: 'could_not', because: 'it has no instructions file yet, and we will not create one' };
    }
    const plan = planFor(current.text || '', opts && opts.now, opts && opts.past);   // `past`: tests only
    if (plan.state === 'could_not') return plan;
    /* #4890: cutting an older copy is consented to only in the per-agent dialog, which shows it and always sends
       its hash. The fleet click (no hash, names only) leaves such an agent for its own page. */
    if (!(opts && opts.expectHash)) {
      let carried = null;
      try { const p = store.readProfile(sessionName) || {}; carried = Number.isFinite(p.doctrineVersion) ? p.doctrineVersion : null; } catch { carried = null; }
      if (personEditedAtCarried(plan, carried)) return { state: 'current' };   // as status() says, so the two agree
      const leaves = fleetLeaves(plan);
      if (leaves) return { state: 'could_not', because: leaves };
    }
    if (plan.state === 'current') {
      /* Already has them: said, never silent, and NOTHING is written --
         not even a re-dated sentence (constraint 4: a no-op write rotates
         the person's one-deep .previous undo for a non-change). */
      return { state: 'current' };
    }
    /* Two consent strengths, each stated where it is enforced (Angel's
       review, decision recorded): the PER-AGENT route REQUIRES the hash,
       so that path's "the click writes exactly what the dialog showed" is
       enforced, not asserted; the FLEET path passes none, deliberately --
       its dialog lists NAMES, and Mona Lisa's ruling makes the fleet click
       name-level consent ("consent for the listed names only"), with the
       freshly-composed write still incapable of wrong bytes. A stale hash
       refuses with look-again rather than writing a composition nobody
       saw; the hash embeds the click-day date, so a dialog opened at 23:59
       and clicked at 00:01 refuses falsely once and the retry works --
       known, benign, and cheaper than a dateless hash. */
    if (opts && opts.expectHash && opts.expectHash !== plan.hash) {
      return { state: 'could_not', because: 'its instructions changed since you looked, so nothing was written; look again' };
    }
    /* The write: the SAME fileNext the plan composed and the dialog hashed.
       spliceBlock already preserved every byte outside the markers. */
    instructions.write(sessionName, plan.fileNext, current.version, undefined,
      { who: 'kosmos', because: plan.replacing ? 'replaced its older working rules with the current ones, with your OK'
        : plan.updating ? 'updated the working rules, with your OK' : 'added the working rules, with your OK' });
    try {
      /* kosmos#5635 review 4: the click records the block it wrote too, so a person who restores the earlier rules
         after a click is not overwritten by the next boot's sweep. */
      store.writeProfile(sessionName, { doctrineVersion: defaults.DOCTRINE_VERSION, doctrineWrote: currentBlockHash() });
    } catch { /* the file is the truth; the record catches up on the next write */ }
    return { state: 'added', sections: plan.sections.map((s) => s.heading) };
  } catch (err) {
    const raw = (err && err.message) || '';
    return {
      state: 'could_not',
      because: /larger than an instruction file should be/.test(raw)
        ? 'its instructions are already at the size limit'
        : (raw || 'we could not write to its instructions'),
    };
  }
}

/**
 * kosmos#5635 F1: bring an agent's working rules current with NO click, when the text being replaced is provably
 * Kosmos's own and unedited: a span whose content is, byte for byte, a WHOLE earlier block (wholeKnownBlock, with exact
 * marker and frame lines), or a plain, unedited copy of one ending at a clean boundary (`replacing`). At most once per
 * BLOCK per agent (doctrineWrote, the current block's hash): a person who puts the earlier rules back after this
 * block was written has their way (review 3), and a later block (a text fix, with or without a version bump) is
 * still brought in (review 4). Josh's 2026-10-07 feedback found every agent on a test
 * project still carrying a line fixed on main five days before (#4582), the third report of that staleness (#4890,
 * #5297): the click that would have fixed it is not happening, so the person never gets the fix.
 *
 * What still needs the click, and why: a span the person EDITED (their words), a file with no rules block (adding
 * sections to a file Kosmos never wrote rules into is adding to the person's text), and an agent whose person said
 * Not now to this version. The person's own words are never touched: the write is planFor's fileNext, which
 * spliceBlock or pastBlockIn compose byte for byte outside Kosmos's text.
 *
 * Returns { state: 'added', sections } when it wrote, { state: 'current' } when there was nothing to do,
 * { state: 'left', because } when the change waits for the click, or { state: 'could_not', because }. Never throws.
 */
function refreshUnedited(sessionName, roster, opts) {
  try {
    if (!projects.heldExactly(sessionName, roster)) return { state: 'could_not', because: 'we could not tell that this agent is ours' };
    const current = instructions.read(sessionName);
    if (!current.exists) return { state: 'could_not', because: current.because || 'it has no instructions file yet' };
    const plan = planFor(current.text || '', opts && opts.now, opts && opts.past, autoLine(opts && opts.now));   // `past`: tests only
    if (plan.state !== 'refresh') return plan;
    /* Review 1 (the blocker): a span is written over only when its content is a WHOLE earlier block. planFor's
       `edited` is false for a span whose sections each match an earlier section, which is also true of a span the
       person deleted a section from or reordered: those wait for the click. A span from an older click that added only
       missing headings is left too, the safe side. */
    const span = projects.findBlock(current.text || '', START, END);
    const notWhole = { state: 'left', because: 'its working rules are not a copy Kosmos wrote whole, so they change only with your OK' };
    if (span && !span.ambiguous) {
      const text = current.text || '';
      const lineEnd = text.indexOf('\n', span.start);
      const inner = text.slice(lineEnd + 1, span.end - END.length);
      /* Review 2: the marker lines are compared too (words typed on the start marker's line, or before the end marker,
         are the person's), every frame-prefixed line must be a frame Kosmos wrote, and a span with Windows line endings
         is left for the click (the rewrite would mix endings in the person's file). */
      if (text.slice(span.start, lineEnd) !== START || !inner.endsWith('\n') || /\r/.test(inner)) return notWhole;
      if (inner.split('\n').some((l) => l.startsWith('<!-- Kosmos added the working rules below on ') && !isKosmosFrame(l))) return notWhole;
      if (!wholeKnownBlock(sectionContentOf(inner), opts && opts.past)) return notWhole;
    }
    /* Review 2: a plain copy is replaced only when EVERY section is written: a heading the person also has elsewhere
       leaves one out, which the dialog shows and a write with no click would not. */
    if (plan.replacing === true && !plan.updating && plan.sections.length !== defaults.sections().length) return notWhole;
    /* Review 3: and only when the copy ends at a clean boundary (the end of the file, a blank line, a heading or a marker
       line): a line the person typed under its last section reads as part of it for pastBlockIn, and would be cut off
       from it by the write. */
    /* Review 5: on EVERY replace, a span in the file too: the copy being cut is the one outside the span. */
    if (plan.replacing === true) {
      const text = current.text || '';
      const old = pastBlockIn(text, opts && opts.past, span && !span.ambiguous ? span : null);
      const rest = old ? text.slice(old.end).replace(/^\r?\n/, '') : '';
      if (!old || !(rest === '' || /^(?:\r?\n|#|<!--)/.test(rest))) return notWhole;
    }
    /* A last guard on the plan itself: the checks above already leave every edited span, so `edited` is not reached
       today; a plan that is neither an update nor a replace (sections missing from a file with no block) is the
       person's text to add to, and waits for the click. */
    if (plan.edited === true || !(plan.replacing === true || plan.updating === true)) {
      return { state: 'left', because: plan.edited === true || plan.updating ? 'its working rules were edited, so they change only with your OK' : 'its working rules were never written by Kosmos, so they are added only with your OK' };
    }
    const profile = profileStrict(sessionName);
    if (profile === null) return { state: 'could_not', because: 'we could not read what this agent has on record (a Not now, say), so we did not change its rules' };
    if (profile.doctrineDeclined === defaults.DOCTRINE_VERSION) return { state: 'left', because: 'you said Not now to these rules for this agent' };
    /* Review 3/4: once per BLOCK. If today's block was already written into this agent's file (by this sweep or by a
       click) and an earlier one is there again, a person put it back (the Instructions tab's previous version, #4406):
       their choice, and the click is how it changes now. Keyed on the block's hash, not DOCTRINE_VERSION, because text
       fixes ship inside a version (several rows share one in doctrine-past.js), and a later fix must still arrive. */
    const today = currentBlockHash();
    if (profile.doctrineWrote === today) return { state: 'left', because: 'the earlier rules were put back after Kosmos updated them, so they change only with your OK' };
    /* Recorded BEFORE the write (review 4), so a restore can never be overwritten twice; and put back if the write
       then fails (review 5), so a failed write costs this boot only and is tried again at the next, rather than
       reading as a restore for as long as this block is current. A record that cannot be saved is no reason to write. */
    const before = Object.prototype.hasOwnProperty.call(profile, 'doctrineWrote') ? profile.doctrineWrote : null;
    try { store.writeProfile(sessionName, { doctrineWrote: today }); } catch { return { state: 'could_not', because: 'we could not record the update for this agent, so we did not make it' }; }
    try {
      instructions.write(sessionName, plan.fileNext, current.version, undefined,
        { who: 'kosmos', because: 'brought its working rules up to date (they were Kosmos\'s own text, unedited)' });
    } catch (err) {
      try { store.writeProfile(sessionName, { doctrineWrote: before }); } catch { /* best effort: the next boot reads it as a restore */ }
      throw err;
    }
    try { store.writeProfile(sessionName, { doctrineVersion: defaults.DOCTRINE_VERSION }); } catch { /* the file is the truth */ }
    return { state: 'added', sections: plan.sections.map((x) => x.heading) };
  } catch (err) {
    return { state: 'could_not', because: (err && err.message) || 'we could not write to its instructions' };
  }
}

/**
 * kosmos#5635 review 1: the board-start sweep, as a function so it can be tested: refreshUnedited for every agent of
 * ours in `roster`, and `owe(sessionName)` for each one written (the running agent read the old rules). Returns the
 * verdicts, one per agent of ours; an unreadable roster (not an array) does nothing. Never throws.
 */
function refreshFleet(roster, owe, opts) {
  if (!Array.isArray(roster)) return [];
  const out = [];
  for (const a of roster) {
    if (!a || a.isNamedOurs !== true || typeof a.sessionName !== 'string') continue;
    const got = refreshUnedited(a.sessionName, roster, opts);
    if (got && got.state === 'added' && typeof owe === 'function') { try { owe(a.sessionName); } catch { /* the file is right */ } }
    out.push({ sessionName: a.sessionName, ...got });
  }
  return out;
}

/** "Not now", remembered server-side per agent until the rules themselves
    change: keyed on the version, so a future bump un-hides the banner. */
function decline(sessionName) {
  try {
    store.writeProfile(sessionName, { doctrineDeclined: defaults.DOCTRINE_VERSION });
    return { declined: true };
  } catch {
    return { declined: false, because: 'we could not save that choice' };
  }
}

module.exports = { START, END, spanBody, clickDate, autoLine, planFor, status, refresh, refreshUnedited, refreshFleet, decline, hashOf, atBirth, birthLine, pastBlockIn, FLEET_LEAVES_REPLACE, FLEET_LEAVES_EDITED, fleetLeaves };
