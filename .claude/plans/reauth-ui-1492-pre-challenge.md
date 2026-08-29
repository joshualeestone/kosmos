---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: reauth-ui-1492
diff_hash: 410201c05f63bf5f8b57ee52c5172a505e22bc89a8ed7a5bce98f7c47930f00b
subdir_audit: passed
timestamp: 2026-08-29T18:44:21Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24, push as ready). Bracketed markers because
the template's own heading is refused by this gate, my #1458.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] NOBODY HAS CLICKED IT.** The tests run the lifted functions against
  a stub DOM. That is stronger than a source match and it is **not a browser**.
  The one thing I cannot rule out from here is a CSS or layout problem: a button
  that renders off-box, wraps badly, or sits somewhere a person does not look.
  **The logic is proven; the appearance is not.**
- **[WARNING] A PRE-EXISTING RACE I AM NOT FIXING, NAMED SO IT IS A DECISION.**
  `openAcctAdd()` decides whether a flow is active from `ACCT_FLOW_LAST`, which
  is `null` on a fresh page load. So immediately after a reload, with a sign-in
  genuinely running server-side, the Start button is not yet disabled. This is
  **older than this branch** and it affected `another:true` identically. Widening
  the change to fix it would put an unrelated repair in a card about a missing
  button.
- **[WARNING] `acctReauthChrome` HARDCODES THE STOCK WARNING SENTENCE** to restore
  it, so the markup and the JS now carry that sentence twice. Editing one and not
  the other makes the dialog change its own copy when reopened. Deliberate rather
  than missed: the alternative is caching the original `innerHTML` at load, which
  is worse, because it would silently capture whatever a half-rendered page had.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0 on the diff, planted control 1.
- **[CONVENTION]** No closing keyword. #1492 also wants an agent to be swappable
  onto the recovered account, which this does not touch.

### NITs

- **[NIT]** The provider picker is **hidden** rather than disabled in reauth
  mode. Hidden is right here (it is not a choice), but it is a different
  treatment from every other inert control in this dialog, which disables.

### Attacked and CLEARED

- **PERTURBED SIX ARMS, EACH FAILING EXACTLY ONE TEST AND THE RIGHT ONE.** Two on
  the door, one on the request body, two on the row, one on the chrome. Restores
  sha-verified against the pre-perturbation file.
- **THE DANGEROUS DIRECTION HAS ITS OWN TEST.** A stale `ACCT_REAUTH_DIR` makes
  "+ Add a provider" quietly reauth an existing account: worse than the original
  defect, because it succeeds. Pinned by running the real `openAcctAdd`.
- **THE REQUEST BODY IS EVALUATED, NOT MATCHED.** It is a ternary and a source
  match cannot tell a live arm from a dead one. Both arms are built and asserted,
  plus that neither carries both flags (the route refuses that pair) and that
  neither is a plain start (the #248 hazard).
- **FOUND AND FIXED A STALE SIBLING ASSERTION**, which is the defect
  `the-check-you-are-writing-hides-the-one-that-exists` names. `accounts-add`
  claimed *"the ONE request this button makes carries { another: true }"* and
  **stayed green through the change** because the old arm is still in the source.
  Restated as the invariant that is true.
- **THE STUB DOM THROWS ON AN UNKNOWN id RATHER THAN ANSWERING undefined**, so a
  missing stub reads as "the page asked for #x" instead of as the product being
  broken.
- **Suite 2955 pass, 0 fail.** 2951 before, plus these four: the arithmetic is
  the control that my file actually ran.

### The reason this card existed at all

**The route was merged and inert.** #1497 landed at 12:18 and `index.html`
referenced `accountDir` **zero** times. Everything about that PR read as done
except the only thing that matters, which is that a person could reach it.
