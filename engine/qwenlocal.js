'use strict';
/**
 * #5977 slice 3: set Qwen up on this computer through Ollama, from the Add a provider flow.
 *
 * A local Qwen account names the model kosmos-qwen2.5-7b-16k:latest (qwenaccounts LOCAL.model): qwen2.5:7b with its
 * context raised to 16k, because at Ollama's default 4096 the person's request is pushed out of the window. That
 * model is Kosmos's own name, so nobody has it until Kosmos makes it. This module answers what is missing and does
 * the two steps:
 *   - make the 16k model from qwen2.5:7b (POST /api/create with `from` and `parameters.num_ctx`; seconds, no
 *     download: Ollama 0.20 shares the base model's files, MEASURED 2026-10-12);
 *   - download qwen2.5:7b when it is not there (POST /api/pull, about 4.7 GB). Only ever started by the person's
 *     own confirm (the server route is the only caller), never as a side effect of a status read.
 *
 * Kosmos does not install Ollama itself. With no Ollama answering, the state says so and nothing is attempted.
 * Every network answer is reduced to a state and a sentence; no raw error text reaches the page.
 */
const { LOCAL } = require('./qwenaccounts');

const OLLAMA = new URL(LOCAL.baseUrl).origin;            // http://localhost:11434
const MODEL = LOCAL.model.replace(/:latest$/, '');      // kosmos-qwen2.5-7b-16k
const BASE = LOCAL.baseModel;                            // qwen2.5:7b
const BASE_SIZE_WORDS = 'about 4.7 GB';

const STATE = Object.freeze({
  NO_OLLAMA: 'no_ollama',           // nothing answered at localhost:11434
  NEEDS_DOWNLOAD: 'needs_download', // Ollama answers, qwen2.5:7b is not there
  NEEDS_MODEL: 'needs_model',       // qwen2.5:7b is there, the 16k model is not
  READY: 'ready',                   // the 16k model is there
  UNKNOWN: 'unknown',               // Ollama answered with something we could not read
});

let transport = null;
/** Tests replace the network: fn(path, { method, body, stream, onLine }) -> { status, body } or { unreachable: true }. */
function setTransport(fn) { transport = typeof fn === 'function' ? fn : null; }

async function call(pathname, opts) {
  if (transport) return transport(pathname, opts || {});
  const o = opts || {};
  const ctl = new AbortController();
  const limit = o.stream ? 120000 : (o.timeoutMs || 10000);   // a stream: the longest silence between two lines
  let t = setTimeout(() => ctl.abort(), limit);
  try {
    const res = await fetch(OLLAMA + pathname, {
      method: o.method || 'GET',
      headers: o.body ? { 'content-type': 'application/json' } : {},
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: ctl.signal,
    });
    if (!o.stream) {
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    }
    /* NDJSON: one JSON object per line. Each line resets the silence timer, so a slow but moving download is never
       cut off, and a stalled one is. The last parsed line is the answer. */
    let last = null;
    let rest = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      clearTimeout(t); t = setTimeout(() => ctl.abort(), limit);
      rest += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl).trim();
        rest = rest.slice(nl + 1);
        if (!line) continue;
        try { last = JSON.parse(line); } catch { continue; }
        if (o.onLine) o.onLine(last);
      }
    }
    if (rest.trim()) { try { last = JSON.parse(rest.trim()); if (o.onLine) o.onLine(last); } catch { /* a torn last line */ } }
    return { status: res.status, body: last };
  } catch {
    return { status: 0, body: null, unreachable: true };
  } finally { clearTimeout(t); }
}

/** The names Ollama lists, or null when it did not answer with a list. */
function namesOf(body) {
  const models = body && Array.isArray(body.models) ? body.models : null;
  if (!models) return null;
  return models.map((m) => (m && typeof m.name === 'string' ? m.name : (m && typeof m.model === 'string' ? m.model : ''))).filter(Boolean);
}
const has = (names, want) => names.includes(want) || names.includes(want + ':latest')
  || (want.endsWith(':latest') && names.includes(want.slice(0, -':latest'.length)));

/** What this computer is missing for a local Qwen account, as { state, because }. Reads only; never changes anything. */
async function status() {
  const r = await call('/api/tags', { method: 'GET' });
  if (r.unreachable) return { state: STATE.NO_OLLAMA, because: 'Ollama is not running on this computer, or is not installed. Qwen runs on this computer through Ollama (ollama.com).' };
  const names = r.status === 200 ? namesOf(r.body) : null;
  if (!names) return { state: STATE.UNKNOWN, because: 'Ollama answered, but not with its list of models' };
  if (has(names, MODEL)) return { state: STATE.READY, because: 'Qwen is set up on this computer' };
  if (has(names, BASE)) return { state: STATE.NEEDS_MODEL, because: `Ollama has ${BASE}; Kosmos makes a 16k-context copy of it for its agents (no download)` };
  return { state: STATE.NEEDS_DOWNLOAD, because: `Ollama does not have ${BASE} yet. It is a download of ${BASE_SIZE_WORDS}.` };
}

/** Make the 16k model from the base. { ok, because }. */
async function makeModel() {
  const r = await call('/api/create', {
    method: 'POST', timeoutMs: 120000,
    body: { model: MODEL, from: BASE, parameters: { num_ctx: LOCAL.contextWindow }, stream: false },
  });
  if (r.unreachable) return { ok: false, because: 'we could not reach Ollama on this computer; is it running?' };
  if (r.status === 200 && r.body && r.body.status === 'success') return { ok: true, because: `made ${MODEL} from ${BASE}` };
  return { ok: false, because: `Ollama did not make the Qwen model (it answered ${r.status || 'nothing usable'})` };
}

/* ---- the download: one at a time, its progress read by the page ------------------------------------------- */

let pull = null;   // { running, completed, total, ok, because, startedAt }

function pullProgress() {
  if (!pull) return null;
  return { running: pull.running, completed: pull.completed, total: pull.total, ok: pull.ok, because: pull.because };
}

/**
 * Start downloading the base model. Returns at once: { started: true } or { started: false, because } when one is
 * already running. When the download finishes it makes the 16k model too, so the person's one confirm ends in a
 * usable account. The page reads pullProgress() until running is false.
 */
function startDownload() {
  if (pull && pull.running) return { started: false, because: 'Qwen is already downloading' };
  pull = { running: true, completed: 0, total: 0, ok: null, because: '', startedAt: Date.now(), layers: new Map() };
  const mine = pull;
  (async () => {
    const r = await call('/api/pull', {
      method: 'POST', stream: true, body: { model: BASE, stream: true },
      /* UI review: Ollama reports a pull layer by layer ({ digest, total, completed }), so one layer's figures are not
         the download's. Each layer is kept by its digest and the figures are the sums, so a small last layer cannot
         make the page say 100% of 0.0 GB, and the percentage never runs backwards. */
      onLine: (line) => {
        if (!line || !Number.isFinite(line.total) || line.total <= 0) return;
        const id = typeof line.digest === 'string' && line.digest ? line.digest : String(line.status || '');
        const done = Number.isFinite(line.completed) ? line.completed : 0;
        const prev = mine.layers.get(id) || { total: 0, completed: 0 };
        mine.layers.set(id, { total: line.total, completed: Math.max(prev.completed, done) });
        let total = 0; let completed = 0;
        for (const l of mine.layers.values()) { total += l.total; completed += l.completed; }
        mine.total = total; mine.completed = Math.min(completed, total);
      },
    });
    if (r.unreachable) { mine.ok = false; mine.because = 'the download stopped: we lost Ollama on this computer'; return; }
    if (!(r.status === 200 && r.body && r.body.status === 'success')) {
      mine.ok = false;
      mine.because = r.body && typeof r.body.error === 'string' ? 'Ollama could not download Qwen' : `the download did not finish (Ollama answered ${r.status || 'nothing usable'})`;
      return;
    }
    const made = await makeModel();
    mine.ok = made.ok;
    mine.because = made.ok ? 'Qwen is downloaded and set up on this computer' : made.because;
  })().catch(() => { mine.ok = false; mine.because = 'the download stopped'; })
    .finally(() => { mine.running = false; });
  return { started: true };
}

function resetForTest() { pull = null; transport = null; }

module.exports = { STATE, MODEL, BASE, OLLAMA, status, makeModel, startDownload, pullProgress, setTransport, resetForTest };
