'use strict';
/**
 * #4560: read an org chart picture or PDF with a KEY-connected OpenAI, Gemini or Grok, in a direct HTTPS API call.
 *
 * #4559 reads one with Claude Code (every tool switched off by flags). A key is a direct API call, so no tools is
 * true by construction: no request here ever carries a `tools`, `functions` or `tool_choice` field, and a test
 * reads the bytes sent to prove it. The rest of #4559's rules hold: the person is asked first (naming this
 * provider and account), the file goes inline, the answer is JSON to a schema and is validated by
 * orgchartfile.fromModel exactly as Claude's is.
 *
 * Every provider fact below is from its own current docs (2026-09-29; sources on #4560's plan and in the PR),
 * not from memory: the endpoint, the model id, the inline file shape, the JSON-schema field, where the answer is,
 * `store` and `max_output_tokens`. All three keep a request's saved state by default (xAI: "This behavior is on by
 * default", its generate-text guide), and an org chart
 * names real employees, so every request says `store: false`. Each still keeps what is sent for a while for abuse
 * checks whatever `store` says (KEEPS below, which the consent box shows).
 *
 * The provider URLs can be overridden by AGENT_WORKFORCE_ORGCHART_*_URL, for the tests' stub server, and ONLY to this
 * computer (127.0.0.1 or [::1]): no override can name another host. Whatever listens on that local port does get
 * the key and the file, so the override is only as safe as the board's own environment, which is the person's. A redirect is
 * refused, never followed: a key or the file must not reach a host it was not sent to.
 *
 * 🔑 THE KEY. Read from its account folder only when a read is sent (readApiKey), sent only in a header, and never
 * put in a URL, argv, a log line, an error or anything returned. Errors are built from the status code and the
 * provider's own error code field, never from a raw body or the request.
 */

const MAX_ANSWER_BYTES = 4 << 20;   // a real answer is a few kilobytes
/* A cap on what the model may generate, reasoning included, because the read is billed to the person's key: well
   past a large chart's answer (2000 people is about 200 KB of JSON), so it only stops a runaway. Under each model's
   own ceiling, from its docs: gpt-6-astra "128,000 max output tokens"; grok-4.7 "Output limit | No text output
   limit". Both providers' strict JSON schema accept a nullable type array (["string", "null"]), as STRICT_SCHEMA
   uses. */
const MAX_OUTPUT_TOKENS = 64000;
/* An override honoured only to this computer (the tests' stub server): an address, not the name `localhost`, which
   a hosts file can point elsewhere. Any other override is ignored, so the key only ever goes to its provider. */
function urlFrom(envName, fallback) {
  const v = process.env[envName];
  if (!v) return fallback;
  try {
    const u = new URL(v);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return v;
  } catch { /* not a URL */ }
  return fallback;
}
/* 110 s, the same as the Claude read (orgchartfile MODEL_TIMEOUT_MS). The Kosmos+ relay waits 120 s for a board's
   answer (kosmos-relay crates/tunnel/src/proxy.rs BOARD_RESPONSE_HEAD_TIMEOUT), and its clock starts when the phone
   starts sending, while this one starts once the whole file has arrived. So a phone read stays inside the relay's
   wait only when the upload takes under about 10 s; a slow upload of a large file can still see the relay give up
   first, and a key read cut off that way may still be billed (round 3). Was 300 s, which outlived the relay for
   every phone read (round 1). */
const TIMEOUT_MS = 110 * 1000;
let timeoutMs = TIMEOUT_MS;
/** Tests only: a shorter timeout; null restores the real one. */
function setTimeoutMs(ms) { timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : TIMEOUT_MS; }

/* The strict form of orgchartfile's SCHEMA: strict JSON-schema modes need every property required and no extra
   ones, so `why` is required and may be null. fromModel reads both forms the same way. */
const STRICT_SCHEMA = {
  type: 'object',
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person: { type: 'string' },
          title: { type: 'string' },
          reportsTo: { type: ['string', 'null'] },
          sure: { type: 'boolean' },
          why: { type: ['string', 'null'] },
        },
        required: ['person', 'title', 'reportsTo', 'sure', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['people'],
  additionalProperties: false,
};

const b64 = (buf) => Buffer.from(buf).toString('base64');
const dataUrl = (media, buf) => 'data:' + media + ';base64,' + b64(buf);

/* The Responses API answer (OpenAI and xAI): the `output` item of type "message" (a reasoning item may come
   first), its output_text; a `refusal` content item is a refusal. */
function responsesAnswer(body) {
  const out = Array.isArray(body && body.output) ? body.output : [];
  const msg = out.find((o) => o && o.type === 'message');
  const parts = msg && Array.isArray(msg.content) ? msg.content : [];
  if (parts.some((c) => c && c.type === 'refusal')) return { refused: true };
  const text = parts.filter((c) => c && c.type === 'output_text' && typeof c.text === 'string').map((c) => c.text).join('');
  return { text };
}

/* The providers, in the order Settings, AI Models lists them (after Claude, which orgchartfile tries first). */
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    model: 'gpt-6-astra',
    url: () => urlFrom('AGENT_WORKFORCE_ORGCHART_OPENAI_URL', 'https://api.openai.com/v1/responses'),
    headers: (key) => ({ authorization: 'Bearer ' + key }),
    // OpenAI's vision guide: PNG, JPEG, WEBP and non-animated GIF; PDFs through input_file.
    reads: { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 },
    body(prompt, media, buf) {
      const file = media === 'application/pdf'
        ? { type: 'input_file', filename: 'chart.pdf', file_data: dataUrl(media, buf) }
        : { type: 'input_image', image_url: dataUrl(media, buf), detail: 'high' };
      return {
        model: this.model,
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{ role: 'user', content: [file, { type: 'input_text', text: prompt }] }],
        text: { format: { type: 'json_schema', name: 'org_chart', schema: STRICT_SCHEMA, strict: true } },
      };
    },
    answer: responsesAnswer,
  },
  google: {
    name: 'Google Gemini',
    model: 'gemini-3.8-flash',
    url: () => urlFrom('AGENT_WORKFORCE_ORGCHART_GEMINI_URL', 'https://generativelanguage.googleapis.com/v1beta/interactions'),
    // In a header, never the ?key= query string the key check uses: a URL can end up in a log.
    headers: (key) => ({ 'x-goog-api-key': key }),
    // Google's image guide lists PNG, JPEG, WEBP, HEIC and HEIF (not GIF, which its API spec lists: not relied on).
    reads: { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'application/pdf': 1 },
    body(prompt, media, buf) {
      // No output cap here yet: where Gemini takes one is not confirmed from its docs, and Gemini is off (m3688).
      return {
        model: this.model,
        store: false,
        input: [
          { type: media === 'application/pdf' ? 'document' : 'image', data: b64(buf), mime_type: media },
          { type: 'text', text: prompt },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: STRICT_SCHEMA },
      };
    },
    // The Interactions answer: the `steps` item of type "model_output" (a thought step may come first), its text.
    answer(body) {
      const steps = Array.isArray(body && body.steps) ? body.steps : [];
      const out = steps.find((s) => s && s.type === 'model_output');
      const parts = out && Array.isArray(out.content) ? out.content : [];
      return { text: parts.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('') };
    },
  },
  xai: {
    name: 'xAI Grok',
    model: 'grok-4.7',
    url: () => urlFrom('AGENT_WORKFORCE_ORGCHART_XAI_URL', 'https://api.x.ai/v1/responses'),
    headers: (key) => ({ authorization: 'Bearer ' + key }),
    // xAI's docs: image input is jpg/jpeg or png; a PDF only by public URL or an uploaded file, and attaching one
    // turns on a document-search tool, so it is not read here.
    reads: { 'image/png': 1, 'image/jpeg': 1 },
    body(prompt, media, buf) {
      return {
        model: this.model,
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: dataUrl(media, buf), detail: 'high' }, { type: 'input_text', text: prompt }] }],
        text: { format: { type: 'json_schema', name: 'org_chart', schema: STRICT_SCHEMA, strict: true } },
      };
    },
    answer: responsesAnswer,
  },
};
const ORDER = ['openai', 'google', 'xai'];

/* Which providers may read an org chart (Liu Kang's ruling m3688). Gemini is OFF in v1: Google's own terms say
   "Do not submit sensitive, confidential, or personal information to the Unpaid Services", an org chart names real
   employees, and a free key cannot be told from a paid one. Turning it on is this one line (and its request shape
   is kept and tested), if a paid key can be told apart or Josh rules otherwise. Turning it on also means revisiting
   its request: it has no output cap yet, its answer shape and `status` vocabulary are checked only against the docs
   and the stub (see PROVIDERS.google), and a bad key arrives as INVALID_ARGUMENT with the reason in `details`, which
   refusal() does not read yet. */
const ENABLED_DEFAULT = { openai: true, google: false, xai: true };
let enabled = { ...ENABLED_DEFAULT };
/** Tests only: which providers are on; null restores the ruling. */
function setEnabled(map) { enabled = map && typeof map === 'object' ? { ...map } : { ...ENABLED_DEFAULT }; }
/* #5346: as orgchartfile.noModelFor, Claude first and ChatGPT only where it reads. */
function googleOffWhyFor(platform) {
  return 'Claude can read a picture or PDF, connected in Settings, AI Models'
    + (platform === 'win32' ? ', and so can OpenAI or Grok connected with a key (Grok a PNG or JPG picture only)'
      : '. ChatGPT, connected the same way, also reads a PNG or JPG picture, and so can OpenAI or Grok connected with a key (an OpenAI key also reads a PDF)')
    + '. Kosmos does not send an org chart to Gemini: Google\'s terms say not to send personal information on a free Gemini key, and Kosmos cannot tell a free key from a paid one.'
    + ' A CSV or Excel export works with any provider, and so does typing the list.';
}
/* #5346: the same, in one sentence, for when another reason comes first (orgchartfile currentReader). */
const OFF_SHORT = {
  google: 'Gemini is not used for org charts: Google\'s terms say not to send personal information on a free Gemini key, and Kosmos cannot tell a free key from a paid one.',
};
const OFF_WHY = {
  google: googleOffWhyFor(process.platform),
};

/* What each provider keeps even though every request says store:false, from its own docs (Liu Kang m3686; the
   sources are on #4560: OpenAI's "your data" guide, Google's usage policies and Gemini API terms, xAI's security
   FAQ). Shown on the consent line for the provider that will read the file, so the person knows before saying yes. */
const KEEPS = {
  openai: 'OpenAI keeps what you send for up to 30 days to check for abuse, even though Kosmos asks it not to store it. It does not train on it.',
  google: 'Google keeps what you send for 55 days to check for misuse, even though Kosmos asks it not to store it, and its staff may read what it flags. On a free Gemini key, Google also uses it to improve its products, and people may read it.',
  xai: 'xAI keeps what you send for 30 days in case of abuse, even though Kosmos asks it not to store it. It does not train on it.',
};
const keeps = (reader) => (reader && KEEPS[reader.provider]) || null;

/* What a provider cannot read, said as what to do instead. */
function cannotRead(provider, media) {
  const p = PROVIDERS[provider];
  if (!p || p.reads[media]) return null;
  if (media === 'application/pdf') return p.name + ' cannot read a PDF sent this way. Export the chart as a PNG or JPG picture, or use a CSV or Excel export.';
  return p.name + ' cannot read this kind of picture. Save it as a PNG or JPG, or use a CSV or Excel export.';
}

/* The key-connected accounts, in Settings order, default first. Reads NO key: the rows carry authMode only. */
function accountsFrom(mods) {
  const out = [];
  for (const provider of ORDER) {
    let rows = [];
    try { rows = mods[provider].list() || []; } catch { rows = []; }
    rows = rows.filter((r) => r && r.authMode === 'apikey').sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
    // With no name, the key's last four say which key is billed (two unnamed OpenAI keys would read alike).
    for (const r of rows) out.push({ provider, dir: r.dir, account: r.name || r.label || (r.keyTail ? 'key ending ' + r.keyTail : null), keyTail: r.keyTail || null });
  }
  return out;
}
const defaultAccounts = () => accountsFrom({ openai: require('./openaiaccounts'), google: require('./geminiaccounts'), xai: require('./grokaccounts') });
let accountsFn = defaultAccounts;
/** Tests only: replace the account list ([{provider, dir, account}]); null restores the real one. */
function setAccounts(fn) { accountsFn = typeof fn === 'function' ? fn : defaultAccounts; }

/* The reader, and when there is none, why (a switched-off provider IS connected, Gemini alone say), from ONE look
   at the accounts, so the refusal is about the same list the choice was. */
function pick() {
  let list = [];
  try { list = accountsFn() || []; } catch { list = []; }
  const r = list.find((a) => a && PROVIDERS[a.provider] && enabled[a.provider]);
  if (r) return { reader: { provider: r.provider, dir: r.dir, account: r.account || null, keyTail: r.keyTail || null }, offWhy: null };
  const off = list.find((a) => a && PROVIDERS[a.provider] && !enabled[a.provider] && OFF_WHY[a.provider]);
  return { reader: null, offWhy: off ? OFF_WHY[off.provider] : null, offShort: off ? OFF_SHORT[off.provider] : null };
}
function chooseReader() { return pick().reader; }
function offReason() { return pick().offWhy; }

/* The consent line's words for a reader: the provider, and the account when it has a name. */
function label(reader) {
  const p = reader && PROVIDERS[reader.provider];
  if (!p) return null;
  return reader.account ? p.name + ' (' + reader.account + ')' : p.name;
}

function defaultKeyFor(reader) {
  const mods = { openai: './openaiaccounts', google: './geminiaccounts', xai: './grokaccounts' };
  try { return require(mods[reader.provider]).readApiKey(reader.dir); } catch { return null; }
}
let keyFor = defaultKeyFor;
/** Tests only: replace the key lookup (reader -> key); null restores the real one. */
function setKeyFor(fn) { keyFor = typeof fn === 'function' ? fn : defaultKeyFor; }

/* The provider error codes a refusal may name. Anything else is left out of the sentence: a code is text from the
   answer, and only a known one is shown (a proxy could put anything, a key included, in that field). */
const KNOWN_CODES = new Set([
  'invalid_api_key', 'unauthenticated', 'api_key_invalid', 'permission_denied', 'model_not_found', 'not_found',
  'rate_limit_exceeded', 'insufficient_quota', 'resource_exhausted', 'invalid_image', 'invalid_image_format',
  'invalid_base64_image', 'image_too_large', 'unsupported_image_media_type', 'image_parse_error', 'server_error',
  'bad_gateway', 'unavailable', 'internal', 'deadline_exceeded', 'invalid_argument', 'invalid_request_error',
]);
/* A refusal as a sentence the person can act on. Built from the status and a KNOWN provider error code only. */
function refusal(p, status, body) {
  // Nested ({ error: { code } }) or flat ({ code, error: "<message>" }, a shape xAI can send, as grokaccounts reads):
  // `error` is the error only when it is an object, else the code sits at the top level.
  const err = body && typeof body === 'object' ? (body.error && typeof body.error === 'object' ? body.error : body) : {};
  // The provider's own code word: OpenAI and xAI send it as `code`; Google sends a NUMBER as `code` and the word as
  // `status` ({ code: 403, status: "PERMISSION_DENIED" }), so a numeric code falls through to `status`.
  const word = err && typeof err.code === 'string' && err.code ? err.code : (err && typeof err.status === 'string' ? err.status : '');
  const raw = String(word).toLowerCase().slice(0, 60);
  const code = KNOWN_CODES.has(raw) ? raw : '';
  if (status === 401 || /invalid_api_key|unauthenticated|api_key_invalid/.test(code)) {
    return p.name + ' did not accept this key. Check it in Settings, AI Models, or use a CSV or Excel export.';
  }
  // Only a provider CODE says the model or permission is the problem: a bare 403 or 404 can also be a moved endpoint or
  // a blocked region, which is not the key's fault, so it gets the plain sentence (and the log line's diagnosis).
  if (/model_not_found|permission|not_found/.test(code)) {
    return 'This ' + p.name + ' key cannot use ' + p.model + ', the model that reads pictures and PDFs. '
      + 'Check the key\'s access with ' + p.name + ', or use a CSV or Excel export.';
  }
  if (/image|unsupported|invalid_base64/.test(code)) return p.name + ' could not read this file. Try a PNG or JPG picture, or a CSV or Excel export.';
  if (status === 429) return p.name + ' is busy or this key has reached its limit. Try again in a minute, or use a CSV or Excel export.';
  return p.name + ' could not read the chart (' + (status || 'no answer') + (code ? ', ' + code : '') + '). Try again, or use a CSV or Excel export.';
}

/* For the board log only, beside the person's sentence: the error's `type` (from a fixed list) and the request field
   it names (`param`, from the fields this reader sends), so one line tells "our request shape is stale" (a renamed or
   dropped field) from "the file was bad". Neither can carry a key: both come from fixed lists. */
const KNOWN_TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'rate_limit_error', 'server_error', 'api_error']);
// The request fields this reader sends (and their inner parts): a `param` outside this list is not logged at all.
const KNOWN_PARAMS = new Set(['model', 'input', 'store', 'max_output_tokens', 'text', 'text.format', 'text.format.schema',
  'text.format.strict', 'text.format.name', 'response_format', 'response_format.schema', 'image_url', 'file_data',
  'filename', 'detail', 'input[0]', 'input[0].role', 'input[0].content', 'input[0].content[0]', 'input[0].content[1]',
  'input[0].content[0].type', 'input[0].content[0].image_url', 'input[0].content[0].file_data',
  'input[0].content[0].filename', 'input[0].content[0].detail', 'input[0].content[1].type', 'input[0].content[1].text']);
function diagnosis(body) {
  const err = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
  const type = typeof err.type === 'string' && KNOWN_TYPES.has(err.type) ? err.type : null;
  const param = typeof err.param === 'string' && KNOWN_PARAMS.has(err.param) ? err.param : null;
  return [type && 'type ' + type, param && 'param ' + param].filter(Boolean).join(', ');
}

/**
 * Read one file with a key reader. Returns { ok: true, structured } or { ok: false, because }, like the Claude
 * runner. `signal` aborts the request (the person stopped the read or left the page).
 *
 * A failed read leaves one line in the board's log (CLAUDE.md, logging at boundaries), as the Claude path does. The
 * line is the sentence the person sees, which is built from the status and a known provider error code only, so it
 * carries no key and no file (the key-leak test captures the console to keep that true).
 */
async function read(reader, prompt, name, media, buf, signal) {
  const got = await readOnce(reader, prompt, name, media, buf, signal);
  // Not logged: the person's own Stop, and a refusal made before anything was sent (no boundary was crossed).
  if (!got.ok && !got.local && !(signal && signal.aborted)) {
    const who = (reader && PROVIDERS[reader.provider] && PROVIDERS[reader.provider].name) || 'a key provider';
    console.warn('[orgchart] ' + who + ' read failed: ' + String(got.because).slice(0, 300) + (got.diag ? ' [' + got.diag + ']' : ''));
  }
  return got;
}

async function readOnce(reader, prompt, name, media, buf, signal) {
  const p = reader && PROVIDERS[reader.provider];
  if (!p) return { ok: false, local: true, because: 'no provider can read this file' };   // nothing was sent: no log line
  if (!enabled[reader.provider]) return { ok: false, local: true, because: OFF_WHY[reader.provider] || p.name + ' does not read org charts in Kosmos.' };
  const cannot = cannotRead(reader.provider, media);
  if (cannot) return { ok: false, local: true, because: cannot };
  const key = keyFor(reader);
  if (!key) return { ok: false, local: true, because: 'the ' + p.name + ' key could not be read on this computer. Connect it again in Settings, AI Models.' };
  /* The person's Stop and the timeout hold until the WHOLE answer is read, not only its headers: a provider that
     stalls mid-answer is cut off, and the one-read-at-a-time lock is not held past the timeout. Dropping the request
     is Kosmos no longer waiting; it cannot promise the provider stops work it has already started. */
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', stop, { once: true }); }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const gone = () => (signal && signal.aborted ? 'the read was stopped' : 'reading the file took too long');
  let res;
  let raw;
  try {
    try {
      res = await fetch(p.url(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...p.headers(key) },
        body: JSON.stringify(p.body(prompt, media, buf)),
        signal: ctl.signal,
        redirect: 'error',   // never follow: the key and the file go only to the host they were sent to
      });
    } catch {
      // The message of a network error can carry the URL; nothing of it is returned.
      return { ok: false, because: ctl.signal.aborted ? gone() : 'we could not reach ' + p.name };
    }
    // Capped while it arrives, in bytes: a declared length over the cap is refused unread, and a body that grows past
    // it is cut off, so a runaway answer never sits whole in memory.
    const tooLarge = { ok: false, because: p.name + '\'s answer was too large to read' };
    if (Number(res.headers.get('content-length')) > MAX_ANSWER_BYTES) { ctl.abort(); return tooLarge; }
    const chunks = [];
    let size = 0;
    try {
      if (res.body) {
        const it = res.body.getReader();
        for (;;) {
          const { done, value } = await it.read();
          if (done) break;
          size += value.length;
          if (size > MAX_ANSWER_BYTES) { ctl.abort(); return tooLarge; }
          chunks.push(Buffer.from(value));
        }
      }
    } catch {
      return { ok: false, because: ctl.signal.aborted ? gone() : 'the answer from ' + p.name + ' was cut off' };
    }
    raw = Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!res.ok) return { ok: false, because: refusal(p, res.status, body), diag: diagnosis(body) };
  if (!body || (body.status && body.status !== 'completed')) {
    const st = body && ['incomplete', 'failed', 'cancelled', 'in_progress', 'queued', 'requires_action'].includes(body.status) ? ' (' + body.status + ')' : '';
    return { ok: false, because: p.name + ' did not finish reading the chart' + st + '. Try a clearer picture, or a CSV or Excel export.' };
  }
  const got = p.answer(body);
  if (got.refused) return { ok: false, because: p.name + ' declined to read this chart. Try a CSV or Excel export.' };
  if (!got.text) return { ok: false, because: p.name + ' finished without the list we asked for. Try again, or use a CSV or Excel export.' };
  let structured;
  try { structured = JSON.parse(got.text); } catch { return { ok: false, because: p.name + ' did not answer with the list we asked for. Try again, or use a CSV or Excel export.' }; }
  return { ok: true, structured };
}

module.exports = { TIMEOUT_MS, KNOWN_PARAMS, diagnosis, KNOWN_TYPES, pick, KNOWN_CODES, urlFrom, MAX_OUTPUT_TOKENS, offReason, setEnabled, ENABLED_DEFAULT, OFF_WHY, OFF_SHORT, googleOffWhyFor, keeps, KEEPS, setTimeoutMs, MAX_ANSWER_BYTES, accountsFrom, PROVIDERS, ORDER, STRICT_SCHEMA, chooseReader, label, cannotRead, read, setAccounts, setKeyFor, refusal, responsesAnswer };
