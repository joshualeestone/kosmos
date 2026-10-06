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
  if (r.every === 'hour') {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), r.minute, 0, 0);
    if (d.getTime() <= ms) d.setHours(d.getHours() + 1);
    return d.getTime();
  }
  const [h, m] = hm(r.at);
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m, 0, 0);
  if (r.every === 'day') {
    if (d.getTime() <= ms) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  let ahead = (r.day - d.getDay() + 7) % 7;
  if (ahead === 0 && d.getTime() <= ms) ahead = 7;
  d.setDate(d.getDate() + ahead);
  return d.getTime();
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

module.exports = { EVERY, DAY_NAMES, NOTE_MAX, repeatProblem, normalise, nextAfter, describe, noteProblem, fromWords };
