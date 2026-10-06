'use strict';
/**
 * kosmos#4787: a task that REPEATS. A recurring job (a monitor every hour, a report every morning) is an ordinary open
 * task owned by the agent that runs it, so the board shows who does it, when it last ran and when it runs next, instead
 * of the job living outside the task list and the work looking ownerless.
 *
 * The rule, in this computer's local time (the board and the person are on it):
 *   { every: 'hour', minute: 0-59 }                  every hour at :MM
 *   { every: 'day',  at: 'HH:MM' }                   every day at HH:MM
 *   { every: 'week', day: 0-6 (Sunday 0), at: 'HH:MM' } every week on that day at HH:MM
 * Kosmos does not START the job (the person's own scheduler or the agent's loop does); the agent reports each run
 * (`kosmos task ran`), and the next run is worked out from the rule, never stored, so a changed rule never leaves a
 * stale "next". Pure functions only: the writes are tasks.setRepeat / tasks.recordRun.
 */

const EVERY = ['hour', 'day', 'week'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const NOTE_MAX = 500;   // a run's note: one line about what this run found, not the result itself

/* The rule as given (CLI or screen), checked whole: a sentence for what is wrong, or null. */
function repeatProblem(r) {
  if (r === null || r === undefined) return null;   // clearing
  if (typeof r !== 'object' || Array.isArray(r)) return 'a repeat has to say how often: every hour, day or week';
  if (!EVERY.includes(r.every)) return 'a task can repeat every hour, every day or every week';
  if (r.every === 'hour') {
    if (r.minute !== undefined && !(Number.isInteger(r.minute) && r.minute >= 0 && r.minute <= 59)) return 'the minute past the hour has to be 0 to 59';
    if (r.at !== undefined || r.day !== undefined) return 'an hourly task takes only the minute past the hour';
    return null;
  }
  if (typeof r.at !== 'string' || !AT_RE.test(r.at)) return 'say the time as HH:MM on a 24-hour clock, for example 09:00';
  if (r.every === 'day') {
    if (r.day !== undefined || r.minute !== undefined) return 'a daily task takes only the time';
    return null;
  }
  if (!(Number.isInteger(r.day) && r.day >= 0 && r.day <= 6)) return 'a weekly task needs the day of the week';
  if (r.minute !== undefined) return 'a weekly task takes the day and the time';
  return null;
}

/* Only the fields the rule uses, so a stored rule never carries junk from a caller. */
function normalise(r) {
  if (r === null || r === undefined) return null;
  if (r.every === 'hour') return { every: 'hour', minute: r.minute === undefined ? 0 : r.minute };
  if (r.every === 'day') return { every: 'day', at: r.at };
  return { every: 'week', day: r.day, at: r.at };
}

function hm(at) { const m = AT_RE.exec(at); return [Number(m[1]), Number(m[2])]; }

/* The first scheduled time strictly after `ms`, in local time (a Date number), or null for no rule. A daylight-saving
   jump is taken as the clock gives it: a 02:30 rule on the night 02:00 is skipped lands at 03:30, as local time does. */
function nextAfter(rule, ms) {
  const r = normalise(rule);
  if (!r || repeatProblem(r)) return null;
  const from = new Date(ms);
  const y = from.getFullYear(), mo = from.getMonth(), d = from.getDate();
  if (r.every === 'hour') {
    // Hour by hour from this hour's slot, each built from its own parts, so the clock's own rules decide a DST hour.
    for (let k = 0; k <= 26; k += 1) {
      const t = new Date(y, mo, d, from.getHours() + k, r.minute, 0, 0).getTime();
      if (t > ms) return t;
    }
    return null;
  }
  const [h, m] = hm(r.at);
  /* #4787 review 1: each candidate day is built ONCE from (year, month, day + n, h, m). Moving a built Date by setDate
     kept a spring-forward shift (02:30 that night became 03:30) on every later day. */
  for (let n = 0; n <= 8; n += 1) {
    const t = new Date(y, mo, d + n, h, m, 0, 0);
    if (r.every === 'week' && t.getDay() !== r.day) continue;
    if (t.getTime() > ms) return t.getTime();
  }
  return null;
}

function clock(h, m) {
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? h12 + ampm : h12 + ':' + String(m).padStart(2, '0') + ampm;
}

/* The rule in words, for the row and the task page: "every hour at :15", "every day at 9am", "every Monday at 9:30am". */
function describe(rule) {
  const r = normalise(rule);
  if (!r || repeatProblem(r)) return '';
  if (r.every === 'hour') return 'every hour' + (r.minute ? ' at :' + String(r.minute).padStart(2, '0') : '');
  const [h, m] = hm(r.at);
  return (r.every === 'day' ? 'every day' : 'every ' + DAY_NAMES[r.day]) + ' at ' + clock(h, m);
}

/* A run's note, checked: trimmed, one line, at most NOTE_MAX characters. */
function noteProblem(note) {
  if (note === undefined || note === null || note === '') return null;
  if (typeof note !== 'string') return 'a run note has to be text';
  if (note.length > NOTE_MAX) return 'a run note is at most ' + NOTE_MAX + ' characters';
  return null;
}

/* CLI words to a rule: ('day', { at: '09:00' }), ('week', { on: 'mon', at: '09:30' }), ('hour', { at: ':15' }). */
function fromWords(every, opts = {}) {
  const e = String(every || '').toLowerCase().replace(/ly$/, '').replace(/^dai$/, 'day');   // hourly/daily/weekly too
  if (e === 'hour') {
    const at = opts.at === undefined ? undefined : String(opts.at).replace(/^:/, '');
    return { every: 'hour', ...(at === undefined ? {} : { minute: /^\d{1,2}$/.test(at) ? Number(at) : NaN }) };
  }
  if (e === 'day') return { every: 'day', at: opts.at };
  if (e === 'week') {
    const on = String(opts.on || '').toLowerCase().slice(0, 3);
    const day = DAY_NAMES.findIndex((n) => n.toLowerCase().startsWith(on) && on.length === 3);
    return { every: 'week', day: day === -1 ? undefined : day, at: opts.at };
  }
  return { every: e };
}

/* #4787 review 1: the next run as the line says it ("today at 9am", "tomorrow at 9am", "Monday at 9:30am", or a date),
   made on the board in the board's own time, beside the rule's words, so one line never mixes two time zones (a Kosmos+
   view from another computer would otherwise read the next run in its own). `now` is passed in. */
function whenWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = clock(d.getHours(), d.getMinutes());
  const day0 = (x) => { const z = new Date(x); return new Date(z.getFullYear(), z.getMonth(), z.getDate()).getTime(); };
  const days = Math.round((day0(ms) - day0(now)) / 86400000);
  if (days === 0) return 'today at ' + time;
  if (days === 1) return 'tomorrow at ' + time;
  if (days > 1 && days < 7) return DAY_NAMES[d.getDay()] + ' at ' + time;
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' at ' + time;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* #4787 review 1: a repeating task between runs holds no work: its owner is not idle-with-open-work while it waits for
   the next scheduled time. Due again (so open work, nudged and counted) once a scheduled time after its last run (or,
   with no run yet, after it was made) has passed. A task that does not repeat is never waiting. */
const RUN_GRACE_MS = 10 * 60 * 1000;
function graceFor(rule) {
  const r = normalise(rule);
  const period = !r ? 0 : r.every === 'hour' ? 3600000 : r.every === 'day' ? 86400000 : 7 * 86400000;
  return Math.min(RUN_GRACE_MS, Math.floor(period / 30));
}
function waitingForNextRun(t, now = Date.now()) {
  if (!t || !t.repeat) return false;
  // review 4: with no run yet, from when the RULE was set (a rule put on an old task is not due at once).
  const raw = Date.parse(t.lastRunAt || t.repeatSetAt || t.createdAt || '');
  if (!Number.isFinite(raw)) return false;   // no time to measure from: treat it as work, never hide it
  /* review 2: a run stamped more than a minute in the future (a clock stepped back) cannot say when the job last ran,
     so the task is due: work is shown, never hidden. (Measuring from "now" instead would wait for ever, one slot past
     each check.) A run reported a little early (08:59:50 for 09:00) is that slot's run, so the next is measured past a
     short grace. */
  if (raw > now + 60 * 1000) return false;
  /* review 3: the grace is for a RUN reported early, never for the moment the task was made (a task made at 08:55 for
     09:00 must be due at 09:00), and it is a small share of the period: at most 10 minutes, 2 for an hourly job, so a
     late run at 09:55 for the 09:00 slot still leaves 10:00 due. */
  const since = t.lastRunAt ? raw + graceFor(t.repeat) : raw;
  const due = nextAfter(t.repeat, since);
  return due !== null && due > now;
}

module.exports = { EVERY, DAY_NAMES, NOTE_MAX, repeatProblem, normalise, nextAfter, describe, noteProblem, fromWords, waitingForNextRun, whenWords };
