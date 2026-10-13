# #6091: a permission prompt reads "Waiting for you", not "Issue"

**Branch:** `approvalpill-6091` · **Card:** kosmos#6091 (follow-up to #6054)

## The defect
While a Claude agent waits on its permission prompt, its status pill reads "Issue". The 10-13 feedback behind #6054
asked for a clear "waiting on your approval" state, distinct from working and from broken; "Issue" reads as broken.

## The fix
The engine reads the permission prompt off the screen (#6054: `classify` returns needs_you with because APPROVAL_WAITING),
but that `because` does NOT reach the card for most Claude agents (challenge iteration 1): the PermissionRequest hook
(kosmos-report-hook.js) reports the same moment as needs_you by 'auto' with its own words, and reconcileReport keeps the
report's words. So the signal is a separate field, read from the screen before the report is reconciled in:
- `engine/status.js`: `awaitingApprovalOf(scraped, status)` (exported): the scrape is the permission prompt and the
  reconciled state is still needs_you. The pane card carries `awaitingApproval` from it; the paneless card carries false.
- `engine/projects.js`: project members carry it, under the same isNamedOurs gate as stateReportedBy.
- `web/index.html`: `STATE_COPY.approval = { label: 'Waiting for you', attn: true }`; `stateCopyOf` returns it for a
  needs_you card with `awaitingApproval === true`, after the #2808 agent-question case.
- `engine/cardlabel.js` (the second copy, for an agent's own `kosmos report show`, kept equal by cardlabel-5959.test.js):
  the same key and case.

## Decided, not missed
- **Only the word changes; the look stays the needs-you (red) attention state.** #2808 deliberately keeps a technical
  permission prompt red, as the fallback when nothing answers it (web.needsyou-dealarm-2808.test.js pins that), and the
  prompt does block the agent until someone answers. The card asks for the pill's word. If Josh wants it calm (like
  "Question"), that is a one-line change in cardStOf plus attn:false.
- **Counts unchanged.** The board's Issue count already counts every needs_you, including the calm Question; a waiting
  approval is still something that needs the person.
- **A field, not `because`** (iteration 1): see The fix. The field is a boolean, so the page and cardlabel.js need no
  copy of the engine's sentence.
- **The triangle's accessible name stays "Issue"** (LROW_WARN, iteration 1 nit): it belongs to the needs-you look,
  which is kept on purpose; the visible word beside it is "Waiting for you". Changes with the look if Josh wants calm.
- **Rows for another computer's agents (oa-sub) still say "Issue"** (iteration 2): the sibling endpoint
  (server.js statusForSibling) sends only name and state, as strings, by design, so no flag reaches them. Adding one is a
  change to that endpoint's contract; left for a follow-up if it matters.
- **Not gated to Claude** (iteration 2 nit): #6054's detector can in principle read another runner's similar prompt as a
  permission prompt; only the word changes, so no gate is added here.
- **Out of scope: the collapsed request bubble after Yes** (the card's "also seen"; its Done-when is the pill only).
  Noted on the card for a follow-up.

## Weakest premise
That the red needs-you look with the words "Waiting for you" no longer reads as broken. If it still does, the calm look
is the next step (see above).

## Tests
- web.approval-pill-6091.test.js (11): engine, on the real 2.1.296 permission-prompt capture with the hook's report
  reconciled in (review 1's path; a control shows `because` no longer carries it) and with no report; controls (another
  question menu on screen, a non-needs_you reconciled state); both card builders and project members carry the field;
  page: the label, still attn and the needs-you look, controls (false, absent, the string "true", non-needs_you), #2808
  first; cardlabel.js agrees.
- engine/cardlabel-5959.test.js: four new parity cards.
- Mutants: awaitingApprovalOf keyed on the reconciled `because` turns the engine test red; the page line and the
  cardlabel line each turn tests red.
- All 43 engine/status*.test.js plus projects/server tests reading the card shape: 1005/1005.
- The recorded card (docs/browser-checks/fixtures/agent-card.json) carries `awaitingApproval: false`, and the new
  boolean is listed where the recorder's non-string inventory is pinned (render-talk-goldencard-2519.test.js STRUCTURAL,
  tools/capture-agent-card.js category 4) and in fixture-discipline.test.js READ_BY_PROJECTS (iteration 3). Every test
  reading that recording: 86/86.
