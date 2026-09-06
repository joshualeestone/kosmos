# PR draft: Install flow 6 -> 9 screen rework (install-flow-9screen)

Title: `Install flow: rework first-run setup 6 -> 9 screens (Josh's signed-off flow)`

---

## Body

Reworks the first-run install wizard from 6 screens to the 9-screen flow Josh
signed off 2026-09-05 (spec: chaoskosmos `design/install-flow-9-screens.html`).
Split: Mona built the per-screen visuals/copy (10 snippets), Renet built the shell
+ gated-Next + integration, Angel wires Screen 6's two switches (follow-up, against
the merged flow to avoid a web/index.html collision).

### The new flow (linear, steps 1..9)

| # | Screen | Notes |
|---|--------|-------|
| 1 | Welcome | privacy copy STAGED hidden for Josh's placement |
| 2 | Access | gate: `file-access` (Next locked until granted) |
| 3 | Automation | gates: `sleep` + `tmux` (Next locked until BOTH) |
| 4 | Notifications | |
| 5 | Model | reuses the existing model-connect UI (Claude OAuth + OpenAI key) |
| 6 | Self improving | switches for Angel to wire |
| 7 | Success | reuses the app-location reveal + dock line (frPaintReturn) |
| 8 | About you | reuses frPaintYou |
| 9 | Your agents | reuses the found/create/adopt fork (frPaintFleet) |

Retired: the standalone machine-check screen, the standalone Accessibility step
(folded into the S3 tmux gate), and the #2163 preflight interstitial (its content
is distributed across S2/S3/S4 — no line orphaned).

### Mechanism

- **Gated-Next permission poll** (proven 10/10): `FR_GATES` maps each `data-gate`
  row to a status endpoint; a row goes green only on a measured grant, and `#fr-next`
  is disabled only on a measured not-granted reading. Uncheckable (a browser, no
  native writer yet) and any fetch failure fail SAFE — never block, never false-green.
  Generation-guarded; `frGateStart` on entering S2/S3, `frGateStop` on leaving.
- **Hybrid head**: step indicators (crumb + segments) removed per Josh's spec; the
  shell `#fr-title`/`#fr-eyebrow` are retired; each pane owns its own `<h2>`.
  `frFocusActiveHead` tracks the active head by element reference (`FR_ACTIVE_H2`),
  focuses it and points the dialog `aria-labelledby` at it (WCAG 2.1 SC 4.1.3).
- **S3 "Turn On"** buttons fold in the retired open-settings actions (sleep -> Energy,
  tmux -> Accessibility) as one delegated handler on the pane.

### Tests

Full node suite GREEN (4737/0, canonical `run-tests.sh` exit 0). Reconciled the
6->9 renumber blast radius: model pane-slice anchors, fleet title reads
(`fr-fleet-title`), `Continue`->`Next`, the a11y node test rewritten to pin the S3
gate, the stray-comment scanner updated for multiple `<style>` blocks, and the
forced-theme section regenerated. `lib-firstrun-steps.js` is identity-keyed, so the
content-anchored browser checks auto-follow the renumber.

### Follow-ups (tracked, not in this PR)

- Browser-checks: 5 checks for the retired screens are `KNOWN_STALE` and are
  restated to the S2/S3 gates + a new gated-Next check in the browser-check pass
  (needs a quiet Playwright window).
- Angel wires S6's two switches against the merged flow.
- Josh reviews copy + places the staged privacy block.
- Optional visual polish: swap `foundRowsHtml` onto Mona's `.s9-row` styling
  (coordinate with the found-agents lane).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
