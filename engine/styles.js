'use strict';
/**
 * Styles (#480, Josh 19:15): a few named themes, and a paste-in style a
 * person's agent wrote, applied as CSS custom-property overrides.
 *
 * ⚠️ TOKENS ONLY, NEVER A STYLESHEET. A pasted style is lines of
 * `--name: value;` and nothing else: no selectors, no braces, no url(),
 * so what a person pastes can recolor the page and cannot make it fetch,
 * hide, or impersonate anything. The page applies tokens with
 * setProperty on the root element, which also means a custom style sits
 * ABOVE the light/dark machinery: it applies in both schemes, and the
 * tab says so in words rather than surprising anybody.
 *
 * The named themes are complete override sets built from the page's own
 * palette; "kosmos" is the empty set, the page exactly as shipped.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = () => path.join(require('./store').ROOT, 'styles.json');

const THEMES = {
  kosmos: { label: 'Kosmos', tokens: {} },
  slate: {
    label: 'Slate',
    tokens: {
      '--k-bg': '#eef1f4', '--k-surface': '#f8fafc', '--k-rule': '#d5dbe2',
      '--k-ink': '#101418', '--k-ink-2': '#46505b', '--k-sunk': 'rgba(16,20,24,.06)',
    },
  },
  paper: {
    label: 'Paper',
    tokens: {
      '--k-bg': '#f6f1e7', '--k-surface': '#fffdf7', '--k-rule': '#e0d8c8',
      '--k-ink': '#1a1712', '--k-ink-2': '#5a5344', '--k-sunk': 'rgba(26,23,18,.06)',
    },
  },
};

/* One pasted line: a custom property, a safe value, an optional
   semicolon. The value rules shut every door that would turn a color
   file into behavior, and they are structural, not spellings:
   - no braces, angle brackets or mid-value semicolons (LINE's class);
   - NO BACKSLASH, EVER. CSS escapes rewrite spellings under the
     tokenizer (a pasted \75rl( decodes to url( when the browser
     substitutes the token into background:), so a blocklist of literal
     spellings is a guard the escape walks straight through. Colors and
     sizes never need an escape, so the backslash itself is refused,
     which closes the whole encoding family at once;
   - functions by ALLOWLIST: rgb, rgba, hsl, hsla, calc and var are what
     colors and sizes use; url, image-set, expression, and anything
     newer or cleverer is simply not on the list. An @-word anywhere is
     refused the same way.
   Blank lines and full-line comments are allowed so an agent can
   annotate what it wrote. */
const LINE = /^\s*(--[a-z0-9-]{1,40})\s*:\s*([^;{}<>]{1,120}?)\s*;?\s*$/i;
const FN_ALLOWED = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'calc', 'var']);

function valueProblem(value) {
  if (/\\/.test(value)) return 'has a backslash, which a color or size never needs';
  if (/@/.test(value)) return 'has an @-rule, and a style may only set colors and sizes';
  for (const m of value.matchAll(/([a-z-]+)\s*\(/gi) || []) {
    if (!FN_ALLOWED.has(m[1].toLowerCase())) {
      return 'uses ' + m[1] + '(), which a style file does not need';
    }
  }
  return null;
}

function parseTokens(text) {
  const raw = String(text == null ? '' : text);
  if (raw.length > 8000) return { ok: false, because: 'that style is too long; keep it under 8000 characters' };
  const tokens = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*\/\*.*\*\/\s*$/.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) {
      return { ok: false, because: 'line ' + (i + 1) + ' is not a token line; every line looks like --name: value;' };
    }
    const bad = valueProblem(m[2]);
    if (bad) return { ok: false, because: 'line ' + (i + 1) + ' ' + bad };
    tokens.push({ name: m[1].toLowerCase(), value: m[2] });
    if (tokens.length > 60) return { ok: false, because: 'that style sets more than 60 tokens, which is more than the whole page uses' };
  }
  return { ok: true, tokens };
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    const theme = typeof data.theme === 'string' && THEMES[data.theme] ? data.theme : 'kosmos';
    /* The FULL rules on read, not a partial check: a tampered or
       hand-edited file carrying a literal url() (or its escape) must not
       round-trip into applyStyle just because the paste path would have
       refused it. A token the rules refuse is dropped, the inert
       direction. */
    const custom = Array.isArray(data.custom)
      ? data.custom.filter((t) => t && typeof t.name === 'string' && typeof t.value === 'string'
          && LINE.test(t.name + ': ' + t.value) && valueProblem(t.value) === null) : [];
    return { ok: true, theme, custom };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, theme: 'kosmos', custom: [] };
    return { ok: false, theme: 'kosmos', custom: [], because: 'we could not read the saved style' };
  }
}

function write(next) {
  const dir = path.dirname(FILE());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE() + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { flag: 'wx' });
  try { fs.renameSync(tmp, FILE()); }
  catch (err) { try { fs.unlinkSync(tmp); } catch { /* the write failed louder */ } throw err; }
}

/* One request, one write: both halves validated BEFORE anything lands,
   so a refused paste can never leave a half-applied theme behind it. */
function set({ theme, customText }) {
  const now = read();
  let nextTheme = now.theme;
  if (theme !== undefined) {
    if (typeof theme !== 'string' || !THEMES[theme]) return { ok: false, because: 'pick a theme from the list' };
    nextTheme = theme;
  }
  let nextCustom = now.custom;
  if (customText !== undefined) {
    const parsed = parseTokens(customText);
    if (!parsed.ok) return parsed;
    nextCustom = parsed.tokens;
  }
  try { write({ theme: nextTheme, custom: nextCustom }); return { ok: true }; }
  catch { return { ok: false, because: 'we could not save the style' }; }
}

function setTheme(theme) {
  if (typeof theme !== 'string' || !THEMES[theme]) {
    return { ok: false, because: 'pick a theme from the list' };
  }
  const now = read();
  try { write({ theme, custom: now.custom }); return { ok: true }; }
  catch { return { ok: false, because: 'we could not save the style' }; }
}

function setCustom(text) {
  const parsed = parseTokens(text);
  if (!parsed.ok) return parsed;
  const now = read();
  try { write({ theme: now.theme, custom: parsed.tokens }); return { ok: true, count: parsed.tokens.length }; }
  catch { return { ok: false, because: 'we could not save the style' }; }
}

/* What the page actually applies: the theme's set with the custom set on
   top, custom winning, because the pasted file is the person's own last
   word. */
function effective() {
  const now = read();
  const out = { ...THEMES[now.theme].tokens };
  for (const t of now.custom) out[t.name] = t.value;
  return { theme: now.theme, tokens: out, customCount: now.custom.length, ok: now.ok, because: now.because || null };
}

function themeList() {
  return Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label }));
}

module.exports = { read, set, setTheme, setCustom, effective, themeList, parseTokens, FILE, THEMES };
