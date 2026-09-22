# Plan — kosmos#3383: pre-accept Claude Code's first-run onboarding so clean-setup Anthropic agents don't wedge

## The failure (0.6.85 launch blocker)

On a clean setup (Josh's fresh Mac, and a real customer's machine), a newly-created **Anthropic**
agent never responds. Josh's tmux screenshot showed why: the agent's underlying Claude Code CLI
(v2.1.278, the new native installer) is parked on its own **first-run onboarding screen** — the
"Welcome to Claude Code / Choose the text style that looks best with your terminal" theme picker.
The supervisor launches non-interactively into tmux, nothing answers that picker, so the agent
never reaches a ready state and can't be talked to. The board can't read that screen as a question
either, which is why "Clear this message" just spins.

This is exactly why **OpenAI connects but Anthropic doesn't**: the codex CLI has no first-run
onboarding gate; the Claude CLI does.

## Root cause (measured, not assumed)

- A fresh `CLAUDE_CONFIG_DIR` launched interactively shows the theme picker. Seeding that dir's
  `.claude.json` with top-level `hasCompletedOnboarding: true` makes the picker vanish (it jumps
  straight to the trust prompt, which `trustFolder` already pre-accepts). Proven on this box, which
  runs the same claude v2.1.278 Josh runs.
- Kosmos has **never** seeded `hasCompletedOnboarding` (`git log -S` is empty). So this is a
  **missing pre-accept, not a regression.** It only bites a clean install because fleet config dirs
  are already onboarded — the identical reason the Bypass-Permissions prompt (`preacceptBypass`,
  #1919) only bites a fresh install. That is why Josh never hit it in 50+ versions: his prior agents
  reused already-onboarded config dirs.

Three first-run gates a clean install meets, in order: **theme picker (onboarding) -> trust prompt
-> bypass consent**. Kosmos pre-accepts trust (`trustFolder`, #2129) and bypass (`preacceptBypass`,
#1919) but not onboarding. This adds the missing third.

## The fix

A new **`preacceptOnboarding(configDir, agentDefaultAccount)`** in `engine/trust.js`, a direct
sibling of `preacceptBypass`, that seeds **only** the top-level boolean `hasCompletedOnboarding:
true` into the account's `.claude.json`.

It writes **no theme or any other cosmetic key** — measured: `hasCompletedOnboarding: true` alone
suppresses the picker (the seeded agent jumps straight to the trust prompt). That matters because
for a default-account agent the target is the operator's own `~/.claude.json`, so writing a theme
there would silently change a UI preference they never set. Suppressing the onboarding gate on that
shared config is the same scope `trustFolder` / `preacceptBypass` already take (they suppress the
operator's trust / bypass prompts there too); writing a cosmetic preference would not be, so it is
left out. The function is agent-neutral, exactly like its siblings: one consent-like boolean.

- It writes the **same `.claude.json`** `trustFolder` writes (unlike `preacceptBypass`'s
  `settings.json`), so it targets the file via the same `configTarget()` derivation and locks on the
  same file with the same `withFileLock`. The two serialise cleanly rather than lost-updating.
- Same safety as its siblings: refuse a symlinked target, refuse a non-object shape, **merge** (never
  replace, so `trustFolder`'s `projects` map and the person's other config survive), create-if-absent
  (a `{ hasCompletedOnboarding: true }` file is a minimal first-run PREFERENCE, not fabricated
  session history), atomic `wx` write, preserve mode.
- An already-onboarded account returns `already: true` and is left byte-identical — its own theme is
  never overridden.

### Wiring (mirrors `preacceptBypass` exactly)

- `engine/create.js` create path (~4322) and move/setAccount path (~1181): call
  `preacceptOnboarding` alongside the existing `trustFolder` + `preacceptBypass`, Claude-only,
  best-effort / non-gating.
- `engine/win32launch.js` launch (~283) and resume (~433): Windows has its **own** launch path that
  calls `trustFolder` directly (not through `createAgent`), so add the same non-gating
  `preacceptOnboarding` after each trust gate. Josh runs Kosmos on Windows too.

## What finished looks like

- A fresh `CLAUDE_CONFIG_DIR` put through the real create sequence (`trustFolder` +
  `preacceptBypass` + `preacceptOnboarding`) launches interactively straight to the ready composer:
  **no theme picker, no trust prompt** (only "Not logged in / Run /login", the separate sign-in).
  PROVEN end-to-end in tmux on this box.
- `preacceptOnboarding` unit-tested: create (writes ONLY the literal `hasCompletedOnboarding` key,
  no theme/cosmetic key), idempotent, merge-preserves-trust-projects, leaves an already-onboarded
  config byte-identical, records a displaced value, refuses symlink / non-object, fills empty, and the
  create-sequence integration (trust THEN onboarding leaves both gates in one file).
- The full JS suite is green (`node --test engine/*.test.js *.test.js`).

## Scope / non-goals

- **NOT** the login/sign-in step. That is the separate connect flow (#3326/#3367); the theme picker
  sits before it and is a distinct gate. This change gets the agent past onboarding TO login.
- **NOT** the app's "can't read the agent's screen / Clear this message spins" UI — that is Mona's
  UI-honesty half.
- Real money / entitlement untouched. 0.6.85 stays HELD until a genuinely clean Anthropic agent
  starts and answers on its own.

## Verification gaps (disclosed)

- The macOS create path is proven end-to-end (interactive tmux). The **Windows** wiring in
  `win32launch.js` mirrors the same verified pattern and is unit-covered by `trust.test.js`
  (cross-platform), but cannot be exercised end-to-end from this Mac — it needs a real Windows
  retest. Called out so it is not read as measured.
- The relaunch-ensure path (re-applying pre-accepts on every relaunch, #2808) re-applies trust but
  not bypass, and this change matches bypass's placement (create + move only). A running Claude
  session dropping `hasCompletedOnboarding` is the same rare documented race trust.js already accepts;
  a relaunch re-seed is a possible follow-up, not part of the clean-install fix.
