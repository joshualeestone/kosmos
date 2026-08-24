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
   semicolon. The value class shuts the doors that would turn a color
   file into behavior: no braces (rules), no angle brackets (markup), no
   semicolons mid-value (smuggled declarations), and no url() or import
   anywhere (fetches). Blank lines and full-line comments are allowed so
   an agent can annotate what it wrote. */
const LINE = /^\s*(--[a-z0-9-]{2,40})\s*:\s*([^;{}<>]{1,120}?)\s*;?\s*$/i;
const FORBIDDEN = /url\s*\(|@import|expression\s*\(/i;

function parseTokens(text) {
  const raw = String(text == null ? '' : text);
  if (raw.length > 8000) return { ok: false, because: 'that style is too long; keep it under 8000 characters' };
  const tokens = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*\/\*.*\*\/\s*$/.test(line)) continue;
    if (FORBIDDEN.test(line)) {
      return { ok: false, because: 'line ' + (i + 1) + ' loads something from elsewhere, and a style may only set colors and sizes' };
    }
    const m = LINE.exec(line);
    if (!m) {
      return { ok: false, because: 'line ' + (i + 1) + ' is not a token line; every line looks like --name: value;' };
    }
    tokens.push({ name: m[1].toLowerCase(), value: m[2] });
    if (tokens.length > 60) return { ok: false, because: 'that style sets more than 60 tokens, which is more than the whole page uses' };
  }
  return { ok: true, tokens };
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    const theme = typeof data.theme === 'string' && THEMES[data.theme] ? data.theme : 'kosmos';
    const custom = Array.isArray(data.custom)
      ? data.custom.filter((t) => t && typeof t.name === 'string' && LINE.test(t.name + ': ' + t.value)) : [];
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

module.exports = { read, setTheme, setCustom, effective, themeList, parseTokens, FILE, THEMES };
