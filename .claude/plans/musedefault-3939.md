# musedefault-3939: Meta Muse on by default on the Mac

Card: #3939 (Splinter's routing 2026-10-12, after Meta launched Muse Wonder). Follow-up: #6004 (install Muse Code
from inside Kosmos).

## Finished looks like
On a Mac, with no switch set, GET /api/muse says enabled, so every provider list (Settings Add a provider, the
switch dialog, Create Agent, Create a Team, the first-run model step) offers Meta Muse: "Meta Muse" when Muse Code is
installed and signed in, "set up first" with what to do when it is not. AGENT_WORKFORCE_MUSE=0 turns it off. Off a Mac
it stays off (no runner there yet).

## Change
- engine/musestatus.js enabled(): darwin and not AGENT_WORKFORCE_MUSE=0. The preview marker file is no longer read
  (previewMarker and PREVIEW_MARKER removed; a marker left in a data folder changes nothing).
- NOT_INSTALLED_BECAUSE says what to do ("... yet. Install it from Meta, then come back"), the first-run step's words.
  On screen, the pills carry the short form ("Install Muse Code from Meta": Add a provider, Create Agent, Create a
  Team; the old "Set up in Settings, AI Models" pill was for a state Settings cannot fix), and the first-run step has
  its own sentence; the engine's sentence is what GET /api/muse, the CLI and agents read.
- Off spellings: 0, false, off, no (case and spaces ignored), as AGENT_WORKFORCE_ANTIGRAVITY reads.
- First run's under-18 line names Meta Muse only once Muse Code is installed (#5856's rule, now that "on" is every Mac).
- Two first-run browser checks (render-firstrun-grok-3386, render-firstrun-reentry-3359) fail on origin/main too, with
  the same counts; they are not in tools/browser-checks.sh, so nothing runs them. Not this card.
- Tests: the gate test rewritten for default-on (with the off marker and a leftover preview marker as control); tests
  that meant "off" by deleting the variable now set =0; a route test that an unset Mac board answers enabled, not
  installed, with the new sentence.
- The logo list's pill for a Mac without Muse Code is short ("Install Muse Code from Meta"; the pill cannot shrink),
  and render-muse-signin-3939 checks it (153/153 headless).
- engine/connections.js (the "how connecting a provider works" block every agent gets) says Meta Muse can be
  connected on a Mac through Muse Code, which the person installs from Meta first; Meta stays coming soon off a Mac.

## Decided (v1 calls)
- Default on, Mac only. Off switches (support, not settings): AGENT_WORKFORCE_MUSE=0 for one run, and a muse-off
  file in the data folder that lasts (install and update rewrite the board's launchd job with a fixed variable list,
  so the variable alone would be dropped on every update). The old muse-preview-on file is not read.
- Kosmos does not choose the model: Muse Code picks its own and Kosmos reads it from run.model.configured. Rejected:
  passing --model muse-wonder-1.0 (the only official id is the Model API's; not verified for the CLI, and a wrong id
  would break every Muse agent). Revisit if a real turn shows a model other than Muse Wonder.
- Kosmos still does not install Muse Code; #6004 does that as the other providers do.

## Weakest premise
That Muse Code's default model is now Muse Wonder. Not measured: a real turn needs Muse Code installed and signed in
to a Meta account, which no agent machine has.
