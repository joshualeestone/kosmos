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
- NOT_INSTALLED_BECAUSE says what to do ("... yet. Install it from Meta, then come back"), the first-run step's words,
  since most Macs will now see it.
- Tests: the gate test rewritten for default-on; tests that meant "off" by deleting the variable now set =0.

## Decided (v1 calls)
- Default on, Mac only. Rejected: keeping the marker as an opt-out (a hidden file is not a setting anyone finds).
- Kosmos does not choose the model: Muse Code picks its own and Kosmos reads it from run.model.configured. Rejected:
  passing --model muse-wonder-1.0 (the only official id is the Model API's; not verified for the CLI, and a wrong id
  would break every Muse agent). Revisit if a real turn shows a model other than Muse Wonder.
- Kosmos still does not install Muse Code; #6004 does that as the other providers do.

## Weakest premise
That Muse Code's default model is now Muse Wonder. Not measured: a real turn needs Muse Code installed and signed in
to a Meta account, which no agent machine has.
