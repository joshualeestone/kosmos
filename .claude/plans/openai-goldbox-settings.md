# Plan: OpenAI Settings connected-state gold-box (#2241 sibling)

Branch: `openai-goldbox-settings` (agent-workforce / Kosmos app)

## What finished looks like
Adding an OpenAI/codex account in Settings (the add-a-provider modal) ends on the SAME gold
check-row box the first-run flow shows, reading "OpenAI GPT Codex is connected. / This computer
is signed in. (API key ending X)", instead of the bare "Added: API key ending X" line Josh
screenshotted. Matches #2241 (which only covered first-run) and Josh's spec (Splinter-routed).

## Source of truth
Josh (0.6.35) screenshotted the bare "Added: API key ending m61a" in Settings. Splinter routed:
gold-box it via frCheckRow, copy "OpenAI GPT Codex is connected. This computer is signed in."
with the key-ending styled into the box. Method: render-first (screenshot wins over source trace).

## What the render found (probe, not trace)
The Settings OpenAI add sets acct-openai-msg = "Added: API key ending m61a." (visible DURING the
live paintAccounts() verification, which is what Josh caught), then acctShowSuccess flips to the
generic #acct-success panel ("Successfully connected to your OpenAI account (key ending m61a)").
Neither state is the frCheckRow gold-box.

## Change (web/index.html only, plus a browser-check)
- Markup: add `#acct-success-box` (a div, since frCheckRow is a div and cannot sit in the say
  `<p>`) inside #acct-success; give the default big check an id (`acct-success-check`).
- CSS: `.acct-connbox` gold-wash + ok-mark, scoped for Settings (the first-run `.fr-connbox` and
  `#firstrun .fr-check.ok` only apply inside #firstrun; the base `.fr-check` family is global).
- `acctShowSuccess(accountLabel, goldBox)`: optional 2nd arg. With a gold box, hide the default
  check + "Success!" heading + say line (the box carries its own check + title) and show the box;
  else-arm restores the plain panel, so Claude is unchanged and a reopened modal is clean.
- OpenAI add handler: replace the bare "Added: API key ending" transient with a neutral
  "Checking the connection…" (honest during verification), build the gold box from the fetch
  result, and pass it to acctShowSuccess. goldBox is computed BEFORE paintAccounts so the
  `paintAccounts(); acctShowSuccess(` adjacency that web.connect-success-1656 source-pins holds.
- closeAcctAdd: reset the gold-box chrome on close.

## Verification
- New browser-check `docs/browser-checks/render-settings-openai-goldbox.js`: drives the real
  Settings add flow, asserts the gold box paints with the spec copy + key-ending + gold wash, the
  default chrome is hidden; CONTROL asserts a Claude success stays the plain green-check panel.
- Render-verified visually (eyes-on screenshot). No page errors.

## Deliberate choices / weakest premise
- Neutral transient rather than gold-boxing the transient too (avoids a gold-box flash in the form
  then again in the panel; single gold-box in the final panel).
- Claude Settings success left as the plain green-check panel (Josh's spec was OpenAI-specific;
  Claude's gold treatment is first-run/subscription, a separate surface).
- Weakest premise: the gold box shows on res.ok (the key was stored), same as the prior flow did;
  it does not re-gate on the live paintAccounts verdict. Same behavior as before, and #2241's
  first-run box has the same "a credential exists" semantics (#874). If the live check should gate
  the "connected" wording, that is a separate product call.
