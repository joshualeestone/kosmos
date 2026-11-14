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
 *      plugin's tool is named mcp__<server>__<action>, so the name says which service and which action. ONE outcome
 *      is ever recorded this way, "The service does not offer this", and only when the error line STARTS by saying
 *      the tool is unknown AND names the very action that was called ("Unknown tool: merge_contacts" after a call to
 *      merge_contacts). Three review rounds (kosmos#8519) showed that sorting free error text any further mislabels
 *      ordinary errors: "Payment method not found" is a missing record, a firewall's 403 on a plugin's endpoint
 *      would mark every action refused, a rate limit or an archived repository reads as "not allowed". The guide
 *      tells agents to read these findings, so one wrong label can keep them off a working action, and only a hand
 *      record clears it (the hook never sees a success). So permission, scope and policy are recorded only by an
 *      agent, which can read the whole situation. Claude Code's own refusals ("Permission to use ... has been
 *      denied", "No such tool available": this computer, not the service) are never recorded.
 *   2. By hand, `kosmos connections found <service> <action> <outcome> [note]`: any outcome, by any agent (Codex,
 *      Gemini, Grok and Muse have no such hook), and for Kosmos's own connections, whose actions fail inside a shell
 *      command where no tool name says which service it was. The only way "works" is ever recorded.
 *
 * WHAT IS KEPT: the latest outcome per service and action, who found it and when. A hand record is kept 30 days, an
 * automatic one 7. An automatic finding never replaces a hand record, and a hand "works" clears an automatic finding
 * for the same action wherever it is filed (a plugin and Kosmos's own connection of one name are two rows). Action
 * names match whatever their case, spaces, underscores or hyphens. At most 50 actions per service and 60 services. A
 * note is at most 200 characters and is refused if it looks like it carries a key (the diagnostics redactor would
 * change it). Never throws to a caller: a store that cannot be read reads as nothing found.
 *
 * ON DISK: store.ROOT/connfound.json, read and written synchronously, so two requests on the board's one event loop
 * never interleave a read and a write.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_AUTO_MS = 7 * 24 * 60 * 60 * 1000;   // an automatic finding: a hint, kept a week
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
  'needs-permission': 'The account is not allowed to do this',
  'off-by-policy': 'Off by company policy',
  failed: 'Failed, reason unknown',
  works: 'Works',
});

/* A service or action name: what an agent may type, and what an MCP tool name holds. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._:\/-]{0,79}$/;

function file() { return path.join(store.ROOT, 'connfound.json'); }

/* Review 2: C1 controls and the bidi and direction marks go too, so a note cannot reorder what a terminal or the page
   shows around it. Review 3: and the zero-width characters, so a key cannot be split past the note check. */
function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* The name a service is matched by: case and spacing do not make two services. */
/* Review 4: a plugin's server name as Claude Code writes it (claude_ai_Google_Drive, plugin_discord_discord) shown the
   way a person reads it ("Google Drive", "discord"): the provider's prefix dropped, a plugin's doubled name collapsed
   (only a plugin's: a server really called foo_foo keeps it), underscores read as spaces. The hook and a hand record
   both go through it, so an agent that copies the server part of a tool name lands on the same row. */
function serverName(raw) {
  let server = String(raw == null ? '' : raw).trim();
  const plugin = /^plugin_/i.test(server);
  server = server.replace(/^claude_ai_/i, '').replace(/^plugin_/i, '');
  if (plugin) {
    const parts = server.split('_');
    if (parts.length % 2 === 0) {
      const half = parts.length / 2;
      if (parts.slice(0, half).join('_') === parts.slice(half).join('_')) server = parts.slice(0, half).join('_');
    }
  }
  return clean(server.replace(/_/g, ' '), MAX_NAME);
}
function serviceKey(name) { return serverName(name).toLowerCase().replace(/[\s_]+/g, '-'); }
/* Review 2: the key it is FILED under carries its kind, so the person's own GitHub plugin and Kosmos's GitHub connection
   never share a row: they are two credentials, and the remedy for each lives in a different place. */
function storeKey(name, kind) { return (kind === 'kosmos' ? 'kosmos:' : 'other:') + serviceKey(name); }
/* Review 3: an action is matched whatever its case, spaces, underscores or hyphens: "Create Release", "create_release"
   and "create-release" are one action, shown as first recorded. */
function actionKey(name) { return clean(name, MAX_NAME).toLowerCase().replace(/[\s_-]+/g, '_'); }

/*
 * mcp__<server>__<action> -> { service, action }, or null for any other tool. The server part runs to the next "__"
 * (a server name holds single underscores: plugin_discord_discord, claude_ai_Google_Drive). The name shown drops
 * the provider's own prefixes (claude_ai_, plugin_) and a doubled plugin name (discord_discord), and reads
 * underscores as spaces, so "claude_ai_Google_Drive" shows as "Google Drive". Pure.
 */
function parseMcpTool(tool) {
  const m = /^mcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(String(tool || ''));
  if (!m) return null;
  const service = serverName(m[1]);
  const action = clean(m[2], MAX_NAME);
  if (!service || !action || !NAME_RE.test(service) || !NAME_RE.test(action)) return null;
  return { service, action };
}

/*
 * The one thing a failed call's error line may say automatically: that the service does not offer the action that was
 * called. 'not-offered' only when the line STARTS by saying the tool is unknown (optionally after an "MCP error -32601:"
 * prefix) AND names that action (alone, or as the full mcp__server__action name). Anything else is null: nothing is
 * recorded. "Method not found: tools/call" names no action (the server has no tools at all), "Payment method not
 * found" does not start that way, and Claude Code's own "No such tool available" is this computer. Pure.
 */
const LOCAL_REFUSAL_RE = /permission to use .{0,120}(has been )?denied|user (rejected|denied|declined)|was blocked by a hook|requires approval|hook (blocked|denied)|no such tool available/i;
/* Review 4: an optional "Error:" and "MCP error -NNNNN:" lead, then either "Unknown tool: X" (FastMCP and most Python
   servers) or "Tool X not found" (the TypeScript MCP SDK). Both still anchored, end to end, and X must be the called
   action. */
const LEAD = String.raw`^\W*(?:error:\s*)?(?:MCP error -?\d+:\s*)?`;
const UNKNOWN_TOOL_RE = new RegExp(LEAD + String.raw`(?:unknown tool|no such tool|tool not found|method not found)\s*[:\-]?\s*["'\x60]?([A-Za-z0-9_.-]+)["'\x60]?\s*\.?\s*$`, 'i');
const TOOL_X_NOT_FOUND_RE = new RegExp(LEAD + String.raw`tool\s+["'\x60]?([A-Za-z0-9_.-]+)["'\x60]?\s+not found\s*\.?\s*$`, 'i');
function classify(error, action, fullName) {
  const e = String(error || '').trim();
  const a = String(action || '');
  if (!e || !a || LOCAL_REFUSAL_RE.test(e)) return null;
  const m = UNKNOWN_TOOL_RE.exec(e) || TOOL_X_NOT_FOUND_RE.exec(e);
  if (!m) return null;
  const named = m[1].replace(/\.+$/, '').toLowerCase();
  const want = a.toLowerCase();
  /* Review 5: a full tool name must be THIS server's, not merely end in the action. */
  return named === want || (fullName && named === fullName.toLowerCase()) ? 'not-offered' : null;
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
  try { j = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return Object.create(null); }
  /* Review 2: no prototype, so a service or action named "constructor" or "__proto__" is an ordinary key. */
  const out = Object.create(null);
  const svcs = j && typeof j === 'object' && j.services && typeof j.services === 'object' ? j.services : {};
  for (const [key, s] of Object.entries(svcs)) {
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.actions || typeof s.actions !== 'object') continue;
    const actions = Object.create(null);
    for (const [a, f] of Object.entries(s.actions)) {
      if (!f || !OUTCOMES.includes(f.outcome) || !Number.isFinite(f.at)) continue;
      const how = f.how === 'auto' ? 'auto' : 'agent';
      if (now - f.at > (how === 'auto' ? KEEP_AUTO_MS : KEEP_MS)) continue;
      const shown = clean(typeof f.action === 'string' ? f.action : a, MAX_NAME);
      if (!shown || actionKey(shown) !== a) continue;
      actions[a] = { action: shown, outcome: f.outcome, at: f.at, by: clean(f.by, MAX_NAME), note: clean(f.note, MAX_NOTE), how, n: Number.isInteger(f.n) && f.n > 0 ? f.n : 1 };
    }
    const kind = s.kind === 'kosmos' ? 'kosmos' : 'other';
    if (Object.keys(actions).length && key === storeKey(s.name, kind)) out[key] = { name: clean(s.name, MAX_NAME), kind, actions };
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
  const service = serverName(x.service);   // review 4: as the hook names it
  const action = clean(x.action, MAX_NAME);
  if (!NAME_RE.test(service)) return { ok: false, because: 'name the service in letters and numbers, up to ' + MAX_NAME + ' characters' };
  if (!NAME_RE.test(action)) return { ok: false, because: 'name the action in letters and numbers, up to ' + MAX_NAME + ' characters' };
  if (!OUTCOMES.includes(x.outcome)) return { ok: false, because: 'the outcome is one of: ' + OUTCOMES.join(', ') };
  const by = clean(x.by, MAX_NAME);
  if (!by) return { ok: false, because: 'we could not tell which agent found this' };
  const raw = String(x.note == null ? '' : x.note).replace(/\s+/g, ' ').trim();
  if (raw.length > MAX_NOTE) return { ok: false, because: 'a note is at most ' + MAX_NOTE + ' characters' };
  /* Review 4: checked AFTER cleaning, so a key split by a character that cleaning removes is seen whole. */
  const note = clean(raw, MAX_NOTE);
  const refused = note ? noteRefusal(note) : null;
  if (refused) return { ok: false, because: refused };
  const how = x.how === 'auto' ? 'auto' : 'agent';
  const all = readAll(now);
  const kind = x.kind === 'kosmos' ? 'kosmos' : 'other';
  const key = storeKey(service, kind);
  const ak = actionKey(action);
  const svc = all[key] || { name: service, kind, actions: Object.create(null) };
  const prev = svc.actions[ak];
  /* Review 3: an automatic finding never replaces a hand record; it is a hint, the hand record a judgement. */
  if (how === 'auto' && prev && prev.how === 'agent') return { ok: true, kept: false };
  svc.actions[ak] = { action: prev ? prev.action : action, outcome: x.outcome, at: now, by, note, how,
    n: prev && prev.outcome === x.outcome ? prev.n + 1 : 1 };
  /* Review 3: a hand "works" clears an automatic finding for the same action in the other row of the same name (the
     hook files a plugin under "other"; an agent naming GitHub is filed under Kosmos's own). */
  if (how === 'agent' && x.outcome === 'works') {
    const twin = all[storeKey(service, kind === 'kosmos' ? 'other' : 'kosmos')];
    if (twin && twin.actions[ak] && twin.actions[ak].how === 'auto') {
      delete twin.actions[ak];
      if (!Object.keys(twin.actions).length) delete all[storeKey(service, kind === 'kosmos' ? 'other' : 'kosmos')];
    }
  }
  /* At most MAX_ACTIONS per service, the oldest dropped. */
  /* Review 5: hand records outlive automatic ones here too, as services do below. */
  const names = Object.keys(svc.actions).sort((a, b) => ((svc.actions[b].how === 'agent') - (svc.actions[a].how === 'agent')) || svc.actions[b].at - svc.actions[a].at);
  for (const a of names.slice(MAX_ACTIONS)) delete svc.actions[a];
  all[key] = svc;
  /* At most MAX_SERVICES, the one with the oldest newest finding dropped. */
  /* Review 4: a service holding any hand record outlives one with only automatic findings, then the newest wins. */
  const newest = (s) => Math.max(...Object.values(s.actions).map((v) => v.at));
  const hand = (s) => Object.values(s.actions).some((v) => v.how === 'agent');
  const keys = Object.keys(all).sort((a, b) => (hand(all[b]) - hand(all[a])) || newest(all[b]) - newest(all[a]));
  for (const k of keys.slice(MAX_SERVICES)) delete all[k];
  return writeAll(all) ? { ok: true } : { ok: false, because: 'the record could not be written' };
}

/*
 * A failed tool call from the toolfail hook: recorded only when it is a plugin action the service says it does not
 * know (classify). The error line is only read, never stored. Never throws.
 * @returns {{ recorded: boolean, outcome?: string }}
 */
function noteToolFailure(by, tool, error, opts) {
  try {
    const t = parseMcpTool(tool);
    if (!t) return { recorded: false };
    const outcome = classify(error, t.action, String(tool));
    if (!outcome) return { recorded: false };
    const r = record({ service: t.service, action: t.action, outcome, by, how: 'auto', now: opts && opts.now });
    return r.ok && r.kept !== false ? { recorded: true, outcome } : { recorded: false };
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
    .filter(([, s]) => !want || serviceKey(s.name) === want)
    .map(([key, s]) => {
      const actions = Object.entries(s.actions)
        .map(([, f]) => ({ ...f, words: OUTCOME_WORDS[f.outcome] }))
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
function renderLines(services, now, asked) {
  const t = Number.isFinite(now) ? now : Date.now();
  if (!services.length) return [asked ? 'No agent has recorded anything about ' + clean(asked, MAX_NAME) + ' in the last 30 days.' : 'No agent has recorded what works on a connection yet, in the last 30 days.'];
  const out = [];
  for (const s of services) {
    out.push(s.name + (s.kind === 'kosmos' ? '' : ' (outside Kosmos)') + ': ' + (s.notWorking ? s.notWorking + (s.notWorking === 1 ? ' action does not work' : ' actions do not work') : 'everything tried works'));
    for (const a of s.actions) {
      out.push('  ' + a.action + ': ' + a.words + ' (' + (a.how === 'auto' ? 'seen on a refused call by ' : 'recorded by ') + a.by + ', ' + ago(a.at, t) + (a.n > 1 ? ', ' + a.n + ' times' : '') + ')' + (a.note ? ' - ' + a.note : ''));
    }
  }
  return out;
}

module.exports = { record, noteToolFailure, list, renderLines, parseMcpTool, classify, serviceKey, storeKey, actionKey, ago,
  OUTCOMES, OUTCOME_WORDS, KEEP_MS, KEEP_AUTO_MS, MAX_ACTIONS, MAX_SERVICES, MAX_NOTE };
