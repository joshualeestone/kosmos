# #6091: a permission prompt reads "Waiting for you", not "Issue"

**Branch:** `approvalpill-6091` · **Card:** kosmos#6091 (follow-up to #6054)

## The defect
While a Claude agent waits on its permission prompt, its status pill reads "Issue". The 10-13 feedback behind #6054
asked for a clear "waiting on your approval" state, distinct from working and from broken; "Issue" reads as broken.

## The fix
The engine already says why: `status.js` returns `needs_you` with `because: APPROVAL_WAITING` ("it is waiting for your
approval") for a Claude permission prompt (#6054), and the row carries `because` to the page. So:
- `web/index.html`: `STATE_COPY.approval = { label: 'Waiting for you', attn: true }`, and `stateCopyOf` returns it for a
  `needs_you` whose `because` is that sentence, after the #2808 agent-question case.
- `engine/cardlabel.js` (the second copy, for an agent's own `kosmos report show`, kept equal by cardlabel-5959.test.js):
  the same key and case.

## Decided, not missed
- **Only the word changes; the look stays the needs-you (red) attention state.** #2808 deliberately keeps a technical
  permission prompt red, as the fallback when nothing answers it (web.needsyou-dealarm-2808.test.js pins that), and the
  prompt does block the agent until someone answers. The card asks for the pill's word. If Josh wants it calm (like
  "Question"), that is a one-line change in cardStOf plus attn:false.
- **Counts unchanged.** The board's Issue count already counts every needs_you, including the calm Question; a waiting
  approval is still something that needs the person.
- **The literal, not a shared import, in the page and cardlabel.js** (the page is not a module; cardlabel.js imports
  nothing). web.approval-pill-6091.test.js pins both to `status.APPROVAL_WAITING` byte for byte.
- **Out of scope: the collapsed request bubble after Yes** (the card's "also seen"; its Done-when is the pill only).
  Noted on the card for a follow-up.

## Weakest premise
That the red needs-you look with the words "Waiting for you" no longer reads as broken. If it still does, the calm look
is the next step (see above).

## Tests
- web.approval-pill-6091.test.js (7): the label; still attn with the needs-you look; byte-equal to the engine's sentence;
  controls (another needs_you, no because, a near-miss, a non-needs_you state); #2808's agent question first; cardlabel.js
  agrees.
- engine/cardlabel-5959.test.js: three new parity cards (permission prompt, agent question with the same because, the
  generic ask).
- Mutants: removing the page line turns 3 red; removing the cardlabel line turns 2 red.
- Every test that reads stateCopyOf, cardStOf or cardlabel: 341/341.
