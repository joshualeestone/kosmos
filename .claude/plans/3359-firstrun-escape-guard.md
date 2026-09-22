# kosmos#3359 — First-run: a way back into guided setup

## Problem

In the first-run wizard, pressing Escape marks setup seen (POST `/api/first-run/complete`)
and the wizard never returns on its own. The only warning ("Press Escape to leave setup at
any time; Kosmos will not show it again") is `class="vh"` (screen-reader-only), so a sighted
new user gets NO visible warning. One reflexive Escape permanently removes onboarding with no
route back. Two harms: it is silent, and it is permanent.

## Decision (Mona Lisa, design owner, night shift 2026-09-21)

Fix the PERMANENCE, not the Escape path. The Escape completion flow (`frFinish`) is carefully
edge-cased (FR_FINISHING re-entry guard, AbortSignal.timeout fallback, IME guard, focus
handling), so adding a confirm-on-Escape is the higher-risk change and fights Josh's deliberate
"no visible skip" ruling and clean-pane design. Making the loss RECOVERABLE turns the whole
action reversible, which is the principle the org optimises for.

- Add a "Guided setup" box in **Settings > This computer** (the orientation section that already
  holds "Opening Kosmos") with a quiet button `#set-rerun-setup` that calls `firstRunBoot(true, 1)`
  — the forced-open path (same as the `?first-run=1` deep link) without a reload, so the board
  underneath is not thrown away. `frOpen` re-enters at the welcome screen and `frActions`
  re-enables Continue, so a Continue left disabled by the prior Escape completion does not stick.
- Update the screen-reader warning: it no longer claims the wizard is gone for good; it names the
  Settings re-entry.

### Rejected
- **Confirm-on-Escape / a visible warning banner:** higher risk (touches the edge-cased completion
  path), fights the no-visible-skip ruling, and clutters the clean panes. Reversible follow-up if
  Josh wants Escape itself to warn.

### Weakest premise
- That a user who lost setup will *find* the Settings re-entry. Mitigation: Settings is the obvious
  place to look, and "This computer > Opening Kosmos" is the orientation home. What would change my
  mind: Josh preferring the re-entry in the top-right You menu, or wanting Escape to confirm.

## Verification
- New hermetic browser-check `render-firstrun-reentry-3359.js` (file://, stubs only
  `/api/first-run` to a returning user): controls that the wizard does NOT auto-open with the seen
  flag set, then proves the button reopens it on the welcome screen with Continue re-enabled. Reds
  on origin/main. Wired into `tools/browser-checks.sh` and the README table.
- Unit guards re-run green: dbox-nesting (sibling box), this-computer-1290 ("this computer" voice),
  settings-nav, browser-checks-selectors/indexed.

## Files
- `web/index.html` — new Settings box + `#set-rerun-setup` handler + warning copy.
- `docs/browser-checks/render-firstrun-reentry-3359.js` — new check.
- `tools/browser-checks.sh` — runner registration.
- `docs/browser-checks/README.md` — table row.
