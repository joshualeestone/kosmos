# reauth-email-esc-1760 - escape the account email in the reauth warning innerHTML

## Source
Pre-beta security audit (#1760), output-encoding / stored-XSS slice. The board's
render paths were swept for dynamic strings reaching innerHTML without escaping.

## Finding
`web/index.html` `acctReauthChrome(on, email)` builds the reauth warning with
`warn.innerHTML = '...First, sign in as ' + (email || 'this account') + '...'` -
the account email concatenated into innerHTML with no escaping. It is the ONE
dynamic-string-into-innerHTML sink in the board that skips `esc()`:

- the sibling line one row up (`intro.textContent = '...' + email + '...'`) uses
  textContent, which is inherently safe;
- every other account/name path in the file already escapes: `acctRowHtml`
  (`esc(acctPrimaryName(a))`, `esc(a.organization)`, `esc(a.email...)` inside a
  title), `card()`/`lrow()` (`esc(a.name)`, `esc(a.sessionName)`), the task and
  member-option lists (`esc(t.sentence)`, `esc(m.name)`), and the update-message
  path (every dynamic value pre-escaped before the `'<span>' + text` concat);
- `esc()` covers `& < > "`; it does not escape `'`, but there is no
  single-quoted-attribute sink using `esc()` output anywhere in the file, and no
  dynamic data reaches a `javascript:` / `on*=` / `href` context. So this concat
  is the only gap.

## Severity: LOW (self-XSS / defense-in-depth)
`email` is the address of a Claude/OpenAI account signed in ON THIS MACHINE, read
from the local account store and validated by the provider's OAuth. It is not
remote-attacker-controlled and a real provider email cannot carry `<script>`, so
this is self-XSS at worst today, not a live exploit. It is fixed because (a) it is
the file's one output-encoding inconsistency before a beta, and (b) it is a latent
sink: if the source of `email` ever changes to a less-trusted path, the raw concat
silently becomes live DOM XSS.

## Change (one line)
Wrap the interpolated value in `esc()`:
`... + esc(email || 'this account') + ...`, with a `#1760` comment stating why.

## Rendered impact: none
`esc()` is a no-op on every character in a real email address, so the rendered
warning is byte-identical for all real inputs; no DOM structure, class, copy, or
layout changes. That is why this carries a `Browser-check: <reason>` trailer rather
than a new/updated docs/browser-checks assertion - there is no rendered surface to
assert. Surface gate (#2518) passes: no mapped surface token is touched.

## Verification
- `node --check` on the extracted script region (the file is HTML; check the JS).
- The #1720 coarse gate is satisfied by the `Browser-check:` trailer; #2518 passes.
- Existing `render-account-dup-reauth-2584.js` still covers the reauth control's
  aria-labels (unchanged by this diff).
- Full challenge-loop to convergence before PR.

## What I rejected
- Adding a Playwright browser-check that feeds a crafted HTML email into the reauth
  warning and asserts it renders as text: disproportionate for a no-rendered-change
  escaping fix, and these checks only run at the cut, not the PR gate; the code-path
  reasoning above is the stronger record.
- Leaving it documented-only: it is a one-line in-lane hardening; fixing it now
  closes the sink before beta.

## Weakest premise
That `email` stays locally-sourced + provider-validated. If a future feature routes
another party's email into this dialog, this flips from self-XSS to live XSS - which
is exactly why escaping it now (rather than relying on the provenance) is correct.
