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
   - NO COMMENT INSIDE A VALUE. The tokenizer discards comments before
     it produces tokens, so an empty comment wedged between a function
     name and its open paren splits the ident for our detector while the
     browser reads the joined call. Escapes and comments are the only
     two ident rewrites the tokenizer performs; banning the backslash
     and the comment-opener closes both;
   - functions by ALLOWLIST: rgb, rgba, hsl, hsla, calc and var are what
     colors and sizes use; url, image-set, expression, and anything
     newer or cleverer is simply not on the list. An @-word anywhere is
     refused the same way.
   Blank lines and full-line comments are allowed so an agent can
   annotate what it wrote. */
const LINE = /^\s*(--[a-z0-9-]{1,40})\s*:\s*([^;{}<>]{1,120}?)\s*;?\s*$/i;
/* Every function a color or size legitimately uses, including the
   modern color spaces and calc siblings an asked agent would emit;
   all pure value math, none can fetch or behave. */
const FN_ALLOWED = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch',
  'oklab', 'oklch', 'color', 'color-mix', 'light-dark',
  'calc', 'clamp', 'min', 'max', 'var', 'env']);

function valueProblem(value) {
  if (/\\/.test(value)) return 'has a backslash, which a color or size never needs';
  if (value.includes('/*') || value.includes('*/')) return 'has a comment inside a value, which a color or size never needs';
  if (/\r/.test(value)) return 'has a hidden line break, which a color or size never needs';
  if (value.includes('!')) return 'has an exclamation mark, which a color or size never needs';
  if (/@/.test(value)) return 'has an @-rule, and a style may only set colors and sizes';
  /* Every open paren is judged by the ident TOUCHING it, the way the
     CSS tokenizer builds a function token: ident adjacent to its paren.
     An ident may carry digits, underscores, or non-ASCII letters, which
     a letters-only scan walks past and fails OPEN on. A paren with no
     touching ident is a calc() group and carries no call. The older
     space-tolerant scan stays below it: stricter twice is still strict. */
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '(') continue;
    let j = i;
    while (j > 0 && (/[a-z0-9_-]/i.test(value[j - 1]) || value.charCodeAt(j - 1) > 127)) j -= 1;
    const ident = value.slice(j, i);
    if (ident && !FN_ALLOWED.has(ident.toLowerCase())) {
      return 'uses ' + ident + '(), which a style file does not need';
    }
  }
  for (const m of value.matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!FN_ALLOWED.has(m[1].toLowerCase())) {
      return 'uses ' + m[1] + '(), which a style file does not need';
    }
  }
  return null;
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    const theme = typeof data.theme === 'string' && Object.hasOwn(THEMES, data.theme) ? data.theme : 'kosmos';
    /* The FULL rules on read, not a partial check: a tampered or
       hand-edited file carrying a literal url() (or its escape) must not
       round-trip into applyStyle just because the paste path would have
       refused it. A token the rules refuse is dropped, the inert
       direction. */
    /* Name and value are judged as SEPARATE fields. The earlier
       composed check (LINE over name + ': ' + value) let a store token
       smuggle ': ' inside its name field and still read as one valid
       line; each field now meets its own rule, and the read path
       mirrors the paste path exactly: lowercased names, 60-token cap. */
    const custom = (Array.isArray(data.custom) ? data.custom : [])
      .filter((t) => t && typeof t.name === 'string' && typeof t.value === 'string'
          && /^--[a-z0-9-]{1,40}$/i.test(t.name)
          && /^[^;{}<>\r\n]{1,120}$/.test(t.value) && valueProblem(t.value) === null)
      .slice(0, 60)
      .map((t) => ({ name: t.name.toLowerCase(), value: t.value }))
      /* last wins, as in the paste path, so customCount is what is in force */
      .reduce((m, t) => m.set(t.name, t), new Map());
    /* #520: how the app is laid out. Anything but the consolidated view is
       the tabs, so a missing or odd value is the default, never a refusal. */
    const layout = data.layout === 'consolidated' ? 'consolidated' : 'tabs';
    return { ok: true, theme, custom: [...custom.values()], layout };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, theme: 'kosmos', custom: [], layout: 'tabs' };
    return { ok: false, theme: 'kosmos', custom: [], layout: 'tabs', because: 'we could not read the saved style' };
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
function set({ theme, layout }) {
  const now = read();
  let nextTheme = now.theme;
  if (theme !== undefined) {
    /* Own properties only: 'constructor' and '__proto__' are strings
       the plain lookup would bless and persist. */
    if (typeof theme !== 'string' || !Object.hasOwn(THEMES, theme)) return { ok: false, because: 'pick a theme from the list' };
    nextTheme = theme;
  }
  /* kosmos#1001: the paste-your-own-tokens box is gone, so nothing can SET
     this any more. The stored value is carried through untouched rather than
     dropped: removing a feature is not a licence to delete what somebody
     already saved, and a `custom` key sitting unread costs nothing while
     rewriting the file without it is irreversible. */
  const nextCustom = now.custom;
  let nextLayout = now.layout;
  if (layout !== undefined) {
    if (layout !== 'tabs' && layout !== 'consolidated') return { ok: false, because: 'the layout is tabs or consolidated' };
    nextLayout = layout;
  }
  try { write({ theme: nextTheme, custom: nextCustom, layout: nextLayout }); return { ok: true }; }
  catch { return { ok: false, because: 'we could not save the style' }; }
}

/* What the page applies: the theme's set. kosmos#1001 removed the pasted
   overrides that used to be merged on top -- Josh, 2026-08-26, and the reason
   is the product's own test: it asked a non-technical person to obtain a CSS
   variable file from an agent and paste it into a textarea. There is no
   version of the training-room walkthrough where that is a step.
   ⚠️ `customCount` goes with it. It was only ever read to decide whether to
   show "Remove my style", and that button is gone. */
function effective() {
  const now = read();
  return { theme: now.theme, tokens: { ...THEMES[now.theme].tokens }, layout: now.layout || 'tabs', ok: now.ok, because: now.because || null };
}

function themeList() {
  return Object.entries(THEMES).map(([key, t]) => ({ key, label: t.label }));
}

module.exports = { read, set, effective, themeList, FILE, THEMES };
