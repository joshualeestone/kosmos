'use strict';
/*
 * kosmos#8519: which actions of a connection actually work, as the agents found them.
 *
 * WHY "FOUND" AND NOT "CHECKED". Kosmos cannot see which actions a connection allows. Its own checks
 * (engine/tokendoors.js) make one call per service to confirm a token works and read no scopes, and a plugin the
 * person added in their own Claude or Codex app is not Kosmos's at all. Probing each action live is ruled out: the
 * search services bill per call (#1636), and a write cannot be tested without writing. The only party that learns
 * whether an action works is the agent that tried it, so this records what agents found, and shows it to the person
 * and to the next agent, which then need not try each action to learn the same thing.
 *
 * TWO WAYS IN.
 *   1. Automatically, from a Claude agent's failed tool call (#6071: PostToolUseFailure -> POST /api/toolfail). A
 *      plugin's tool is named mcp__<server>__<action>, so the name says which service and which action, and the
 *      error line is sorted into an outcome (classify). ONLY failures that say something about the ACTION are
 *      recorded: the service does not offer it, it needs a wider sign-in, the account is not allowed, it is off by
 *      policy. A bad input, a timeout or anything unrecognised says nothing about whether the action works, so it
 *      is not recorded (a confident wrong word on the page is worse than none). Claude Code's own permission
 *      refusals ("Permission to use ... has been denied") are this computer's settings, not the service, and are
 *      never recorded.
 *   2. By hand, `kosmos connections found <service> <action> <outcome> [note]`, for agents with no such hook (Codex,
 *      Gemini, Grok, Muse) and for Kosmos's own connections, whose actions fail inside a shell command where no tool
 *      name says which service it was. The only way "works" is ever recorded: the hook does not see successful calls.
 *
 * WHAT IS KEPT: the latest outcome per service and action, who found it and when, for 30 days, at most 50 actions per
 * service and 60 services. A newer finding replaces an older one for the same action, whichever way it went.
 * A note is at most 200 characters and is refused if it looks like it carries a key (the diagnostics redactor would
 * change it). Never throws to a caller: a store that cannot be read reads as nothing found.
 *
 * ON DISK: store.ROOT/connfound.json, read and written synchronously, so two requests on the board's one event loop
 * never interleave a read and a write.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIONS = 50;
const MAX_SERVICES = 60;
const MAX_NOTE = 200;
const MAX_NAME = 80;

/* The outcomes, in the order the page and the CLI list them: what does not work first. */
const OUTCOMES = Object.freeze(['not-offered', 'needs-scope', 'needs-permission', 'off-by-policy', 'failed', 'works']);
/* Josh's voice, no em dashes. "Not tried yet" is never a row: an action with no record is simply absent. */
const OUTCOME_WORDS = Object.freeze({
  'not-offered': 'The service does not offer this',
  'needs-scope': 'Needs a wider sign-in',
  'needs-permission': 'The account is not allowed to',
  'off-by-policy': 'Off by company policy',
  failed: 'Failed, reason unknown',
  works: 'Works',
});

/* A service or action name: what an agent may type, and what an MCP tool name holds. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:\/-]{0,79}$/;

function file() { return path.join(store.ROOT, 'connfound.json'); }

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* The key a service is filed under: case and spacing do not make two services. */
function serviceKey(name) { return clean(name, MAX_NAME).toLowerCase().replace(/[\s_]+/g, '-'); }

/*
 * mcp__<server>__<action> -> { service, action }, or null for any other tool. The server part runs to the next "__"
 * (a server name holds single underscores: plugin_discord_discord, claude_ai_Google_Drive). The name shown drops
 * the provider's own prefixes (claude_ai_, plugin_) and a doubled plugin name (discord_discord), and reads
 * underscores as spaces, so "claude_ai_Google_Drive" shows as "Google Drive". Pure.
 */
function parseMcpTool(tool) {
  const m = /^mcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(String(tool || ''));
  if (!m) return null;
  let server = m[1].replace(/^claude_ai_/, '').replace(/^plugin_/, '');
  const parts = server.split('_');
  if (parts.length % 2 === 0) {
    const half = parts.length / 2;
    if (parts.slice(0, half).join('_') === parts.slice(half).join('_')) server = parts.slice(0, half).join('_');
  }
  const service = clean(server.replace(/_/g, ' '), MAX_NAME);
  const action = clean(m[2], MAX_NAME);
  if (!service || !action || !NAME_RE.test(service) || !NAME_RE.test(action)) return null;
  return { service, action };
}

/*
 * What a failed call's error line says about the ACTION, or null when it says nothing about it (then nothing is
 * recorded). Ordered: Claude Code's own refusal first (never the service), then the most specific. Pure.
 */
const LOCAL_REFUSAL_RE = /permission to use .{0,120}(has been )?denied|user (rejected|denied|declined)|was blocked by a hook|requires approval|hook (blocked|denied)/i;
const NOT_OFFERED_RE = /unknown (tool|method|action|operation|function)|no such (tool|method|action)|method not found|tool not found|not (implemented|supported)|unsupported (tool|method|action|operation)|\b-32601\b/i;
const SCOPE_RE = /insufficient[_ ]scope|missing (the )?(required )?scopes?|scopes? (required|missing|not granted)|requires? (the )?[\w:.\/-]+ scope|not granted the [\w:.\/-]+ scope/i;
const POLICY_RE = /(disabled|blocked|turned off) by (your |the )?(admin|administrator|organi[sz]ation|workspace|company)|organi[sz]ation policy|admin policy/i;
const PERMISSION_RE = /\b(401|403)\b|forbidden|permission denied|insufficient permissions?|not authori[sz]ed|unauthori[sz]ed|access (is )?denied|not allowed to|does not have (the )?(required )?permission/i;
function classify(error) {
  const e = String(error || '');
  if (!e || LOCAL_REFUSAL_RE.test(e)) return null;
  if (NOT_OFFERED_RE.test(e)) return 'not-offered';
  if (SCOPE_RE.test(e)) return 'needs-scope';
  if (POLICY_RE.test(e)) return 'off-by-policy';
  if (PERMISSION_RE.test(e)) return 'needs-permission';
  return null;
}

/* A note that the diagnostics redactor would change carries something that looks like a key, an email or a home
   folder: refused, not silently masked, so the agent learns why. */
function noteRefusal(note) {
  if (note.length > MAX_NOTE) return 'a note is at most ' + MAX_NOTE + ' characters';
  try {
    const redactor = require('./diagredact').makeRedactor();
    if (redactor.redactText(note) !== note) return 'that note looks like it holds a key, an address or a folder path; leave it out';
  } catch { return 'we could not check that note, so it was not kept'; }
  return null;
}

/* The stored findings, expired ones dropped. Never throws: anything unreadable reads as nothing found. */
function readAll(now) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
  const out = {};
  const svcs = j && typeof j === 'object' && j.services && typeof j.services === 'object' ? j.services : {};
  for (const [key, s] of Object.entries(svcs)) {
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.actions || typeof s.actions !== 'object') continue;
    const actions = {};
    for (const [a, f] of Object.entries(s.actions)) {
      if (!f || !OUTCOMES.includes(f.outcome) || !Number.isFinite(f.at) || now - f.at > KEEP_MS) continue;
      actions[a] = { outcome: f.outcome, at: f.at, by: clean(f.by, MAX_NAME), note: clean(f.note, MAX_NOTE), how: f.how === 'auto' ? 'auto' : 'agent', n: Number.isInteger(f.n) && f.n > 0 ? f.n : 1 };
    }
    if (Object.keys(actions).length) out[key] = { name: clean(s.name, MAX_NAME), kind: s.kind === 'kosmos' ? 'kosmos' : 'other', actions };
  }
  return out;
}

function writeAll(services) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    store.saveFlushed(file(), JSON.stringify({ services }));
    return true;
  } catch { return false; }
}

/*
 * Record one finding. Never throws.
 * @param {{ service: string, action: string, outcome: string, note?: string, by: string, how?: 'auto'|'agent',
 *           kind?: 'kosmos'|'other', now?: number }} f
 * @returns {{ ok: true } | { ok: false, because: string }}
 */
function record(f) {
  const x = f || {};
  const now = Number.isFinite(x.now) ? x.now : Date.now();
  const service = clean(x.service, MAX_NAME);
  const action = clean(x.action, MAX_NAME);
  if (!NAME_RE.test(service)) return { ok: false, because: 'name the service in letters and numbers, up to ' + MAX_NAME + ' characters' };
  if (!NAME_RE.test(action)) return { ok: false, because: 'name the action in letters and numbers, up to ' + MAX_NAME + ' characters' };
  if (!OUTCOMES.includes(x.outcome)) return { ok: false, because: 'the outcome is one of: ' + OUTCOMES.join(', ') };
  const by = clean(x.by, MAX_NAME);
  if (!by) return { ok: false, because: 'we could not tell which agent found this' };
  const note = String(x.note == null ? '' : x.note).replace(/\s+/g, ' ').trim();
  const refused = note ? noteRefusal(note) : null;
  if (refused) return { ok: false, because: refused };
  const all = readAll(now);
  const key = serviceKey(service);
  const svc = all[key] || { name: service, kind: x.kind === 'kosmos' ? 'kosmos' : 'other', actions: {} };
  if (x.kind === 'kosmos') svc.kind = 'kosmos';
  const prev = svc.actions[action];
  svc.actions[action] = { outcome: x.outcome, at: now, by, note, how: x.how === 'auto' ? 'auto' : 'agent',
    n: prev && prev.outcome === x.outcome ? prev.n + 1 : 1 };
  /* At most MAX_ACTIONS per service, the oldest dropped. */
  const names = Object.keys(svc.actions).sort((a, b) => svc.actions[b].at - svc.actions[a].at);
  for (const a of names.slice(MAX_ACTIONS)) delete svc.actions[a];
  all[key] = svc;
  /* At most MAX_SERVICES, the one with the oldest newest finding dropped. */
  const newest = (s) => Math.max(...Object.values(s.actions).map((v) => v.at));
  const keys = Object.keys(all).sort((a, b) => newest(all[b]) - newest(all[a]));
  for (const k of keys.slice(MAX_SERVICES)) delete all[k];
  return writeAll(all) ? { ok: true } : { ok: false, because: 'the record could not be written' };
}

/*
 * A failed tool call from the toolfail hook: recorded only when it names a plugin action and says something about
 * the action. `error` must already be redacted (the caller holds the board's secrets). Never throws.
 * @returns {{ recorded: boolean, outcome?: string }}
 */
function noteToolFailure(by, tool, error, opts) {
  try {
    const t = parseMcpTool(tool);
    if (!t) return { recorded: false };
    const outcome = classify(error);
    if (!outcome) return { recorded: false };
    const r = record({ service: t.service, action: t.action, outcome, by, how: 'auto', now: opts && opts.now });
    return r.ok ? { recorded: true, outcome } : { recorded: false };
  } catch { return { recorded: false }; }
}

/*
 * Everything found, for the page and the CLI: services by their newest finding, each one's actions with what does
 * not work first, then newest first. `service` narrows to one (by its key). Never throws.
 */
function list(opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  let all;
  try { all = readAll(now); } catch { all = {}; }
  const want = o.service ? serviceKey(o.service) : null;
  return Object.entries(all)
    .filter(([k]) => !want || k === want)
    .map(([key, s]) => {
      const actions = Object.entries(s.actions)
        .map(([action, f]) => ({ action, ...f, words: OUTCOME_WORDS[f.outcome] }))
        .sort((a, b) => (a.outcome === 'works') - (b.outcome === 'works') || b.at - a.at);
      return { key, name: s.name, kind: s.kind, actions, notWorking: actions.filter((a) => a.outcome !== 'works').length };
    })
    .sort((a, b) => Math.max(...b.actions.map((x) => x.at)) - Math.max(...a.actions.map((x) => x.at)));
}

/* How long ago, in the words the CLI uses. Pure. */
function ago(at, now) {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.round(m / 60);
  if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + ' days ago';
}

/* The lines both CLIs print for `kosmos connections --found [service]`, so the Mac and Windows commands cannot
   drift. Pure over its input. */
function renderLines(services, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  if (!services.length) return ['No agent has recorded what works on a connection yet, in the last 30 days.'];
  const out = [];
  for (const s of services) {
    out.push(s.name + (s.kind === 'kosmos' ? '' : ' (outside Kosmos)') + ': ' + (s.notWorking ? s.notWorking + (s.notWorking === 1 ? ' action does not work' : ' actions do not work') : 'everything recorded works'));
    for (const a of s.actions) {
      out.push('  ' + a.action + ': ' + a.words + ' (' + (a.how === 'auto' ? 'seen on a failed call by ' : 'recorded by ') + a.by + ', ' + ago(a.at, t) + (a.n > 1 ? ', ' + a.n + ' times' : '') + ')' + (a.note ? ' - ' + a.note : ''));
    }
  }
  return out;
}

module.exports = { record, noteToolFailure, list, renderLines, parseMcpTool, classify, serviceKey, ago,
  OUTCOMES, OUTCOME_WORDS, KEEP_MS, MAX_ACTIONS, MAX_SERVICES, MAX_NOTE };
