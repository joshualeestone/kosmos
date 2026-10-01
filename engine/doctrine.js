'use strict';

/**
 * The consented refresh of the working rules (#539): what a person's click
 * adds to an instruction file they own, composed here and NOWHERE ELSE.
 *
 * The constraint the whole card hangs on (Mona Lisa's, on the card): role
 * text is PERSON-OWNED after creation and deliberately never rewritten.
 * This module is allowed near it because nothing here is silent and the
 * person is the author of the change: the click on the ruled dialog is the
 * same act as pasting the missing sections in themselves, with Kosmos
 * holding the pen. Anything that writes without the click, or touches a
 * byte outside the managed span, breaks the ownership rule for real and
 * should be reverted on sight.
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

/* Mona Lisa's sentences (her ruling, verbatim): the dated one is the FIRST
   line inside the constant markers, never the marker itself. "Kosmos may
   update this block" is TRUE: a later consented refresh recomposes the
   span through this same module. */
function openingLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, with your OK. Kosmos may update this block when the rules change; your own words above and below it are never touched. -->`;
}
const CLOSING_LINE = '<!-- end of the working rules -->';
/* #4890: the same frame at birth, where nobody clicked. It starts with the words sectionContentOf strips, so a
   refresh compares the rules and never this line. */
function birthLine(now) {
  return `<!-- Kosmos added the working rules below on ${clickDate(now)}, when it set up this agent. Kosmos may update this block when the rules change, with your OK; your own words above and below it are never touched. -->`;
}

/** The span body for a given set of sections, dated the day of the click (or of the birth, given `opening`). */
function spanBody(sectionsList, now, opening) {
  return [opening || openingLine(now), '', sectionsList.map((s) => s.text).join('\n'), '', CLOSING_LINE].join('\n');
}

/**
 * #4890: the working rules as an agent is BORN with them, inside the managed span, so a later change under an
 * existing heading reaches it through the consented refresh. Before this, birth wrote them as plain text
 * (defaults.appendTo) and planFor can offer a plain file only the headings it lacks, so such a change reached
 * new agents only. Text that already carries the rules is returned as it is, except today's block inline at
 * creation, which is framed in place; text that already holds a
 * doctrine marker (pasted from another agent's file) gets the plain block rather than a span spliced among
 * markers it did not write.
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
 * `replacing` (#4890) is true when the click also removes an unedited plain
 * copy of an earlier block; `updating` when it rewrites an existing span. `past` is the fingerprint table, for tests only;
 * engine/doctrine-past.js otherwise.
 *
 * `sections` is what the dialog lists; `fileNext` is what a click writes;
 * `hash` is how the click proves it consents to THIS composition and not a
 * file that changed since the dialog (the could-not arm of the race is an
 * honest "look again", never a write on a guess).
 */
function planFor(text, now, past) {
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
      const plan = planFor(without, now, past);
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
      const spanNext = spanBody(wanted, now);
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
    const spanNext = spanBody(wanted, now);
    const fileNext = projects.spliceBlock(body, spanNext, START, END);
    return { state: 'refresh', updating: true, sections: wanted, spanNext, fileNext, hash: hashOf(fileNext) };
  }
  /* No span: an agent born with the doctrine as plain text, or born before
     it. Only genuinely absent sections are offered (constraint 8); a file
     carrying every section as the person's own text appends NOTHING. */
  const missing = defaults.missingFrom(body);
  if (!missing.length) return { state: 'current' };
  const spanNext = spanBody(missing, now);
  const fileNext = projects.spliceBlock(body, spanNext, START, END);
  return { state: 'refresh', sections: missing, spanNext, fileNext, hash: hashOf(fileNext) };
}

function hashOf(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

/**
 * What the banner and the dialog need for one agent, no write anywhere.
 */
function status(sessionName, now) {
  const current = instructions.read(sessionName);
  if (!current.exists) {
    return { state: 'could_not', because: current.because || 'it has no instructions file yet' };
  }
  const plan = planFor(current.text || '', now);
  let profile = {};
  try { profile = store.readProfile(sessionName) || {}; } catch { profile = {}; }
  const carried = Number.isFinite(profile.doctrineVersion) ? profile.doctrineVersion : null;
  /* #4890: every agent is born inside the span, so a span that differs at the version it already carries differs
     because the PERSON changed it, not because the rules did. No "updated working rules" banner for that; the next
     version offers the update as usual. */
  if (plan.state === 'refresh' && plan.updating && !plan.replacing && carried !== null && carried >= defaults.DOCTRINE_VERSION) {
    return { state: 'current', carried, currentVersion: defaults.DOCTRINE_VERSION, declined: false };
  }
  return {
    ...plan,
    carried,
    currentVersion: defaults.DOCTRINE_VERSION,
    declined: profile.doctrineDeclined === defaults.DOCTRINE_VERSION,
  };
}

/**
 * The consented write, the reports.tellAgent shape: gate, read, plan,
 * refuse-or-write, and a verdict in a sentence. `expectHash` is the hash
 * the dialog showed; a file that changed since then refuses with "look
 * again" rather than writing a composition nobody saw.
 */
const FLEET_LEAVES_REPLACE = 'its older copy of the rules is replaced only from its own page, where the change is shown';
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
    if (plan.replacing && !(opts && opts.expectHash)) {
      return { state: 'could_not', because: FLEET_LEAVES_REPLACE };
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
      store.writeProfile(sessionName, { doctrineVersion: defaults.DOCTRINE_VERSION });
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

module.exports = { START, END, spanBody, clickDate, planFor, status, refresh, decline, hashOf, atBirth, birthLine, pastBlockIn, FLEET_LEAVES_REPLACE };
