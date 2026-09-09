# ssoredirect-1667 - test the measured mechanism, and name it in the refusal

## Context (kosmos#1667)

I measured this on 2026-08-31: a Vercel preview or deployment URL 302s to `vercel.com/sso-api`,
whose login page answers **200 text/html for every path**. `curl -L` follows that redirect, so a
status-only check reports a confident 200 for a path that cannot exist. Three agents hit it the
same morning on three different endpoints. The card's two tells: read the CONTENT-TYPE not the
status, and prove the host DISCRIMINATES with a negative control that must be able to return the
dangerous answer.

The card was routed in three slices. Two are closed by other people:
- Release tooling (Baron): merged as kosmos#2268, which created `tools/lib/served-verify.sh`.
- Installer `reachable()` (Kitty): addressed by #1662, measured against origin/main.
- **Deployment and preview-URL checks: routed to April.** This branch.

## What I found, and what I did NOT find

**The library is sound and I am not changing any verdict.** Both tells are implemented, media
types are lowercased before matching (so `Text/HTML` cannot slip through), an empty content-type
is refused, and `tools/deploy-site.sh` calls both before trusting a 200. I also suspected the test
was unwired and checked before saying so: `package.json`'s `test:shell` runs it. My first grep was
against `tools/run-tests.sh`, which is simply the wrong instrument.

Two real gaps, both in the same shape the card is about.

### 1. The test modelled a FLATTENING of the failure

`/blind/` answers 200 text/html for every path with **no redirect**. That is the consequence with
the transport removed. The mechanism I measured is a 302 to a page that then 200s everything, and a
guard that handled the flat case while mishandling the redirect would have passed the existing arm.
Nothing on the branch could tell those apart.

⇒ Added `/sso/` (302 to `/ssologin`, which 200s text/html) and drove it. The difference is not
cosmetic: **dropping `-L` flips the `/sso/` host arm from rc=1 to rc=0**, declaring a blind host
sound, where `/blind/` is unaffected. Measured.

### 2. The card's second tell was missing from the DIAGNOSTIC

The card says "drop `-L` so the 302 is visible". Both probes use `curl -sSL`. Following the
redirect does not make the pair of checks miss, so the verdicts stand, but it costs the reason: the
operator is told the symptom and never the mechanism.

⇒ `_served_verify_redirect_note` re-fetches WITHOUT `-L` on the failure path only and appends what
it saw. Every path returns 0 and prints nothing on doubt, because a diagnostic must never change a
verdict the caller already reached.

## The decision worth recording: I did NOT drop -L

The card literally asks for it. Dropping it would change `served_verify_asset_ok`'s verdict from
"200 text/html, a page wearing a success code" to "not served (302)". Both refuse, but the first
names the actual failure and the second reads like a missing file. So I kept `-L` for the verdict
and recovered the visibility as a diagnostic. **What would change my mind:** a case where following
the redirect makes the pair of checks miss rather than merely misreport. I did not find one, and
the scope where a single check IS fooled is now stated in the code (a redirect to a 200 with a
non-html type, reachable for `/setup`, which legitimately expects `text/plain`).

## Corrected during review, and worth keeping

The note's first version fired on any 3xx and then asserted "that is the auth-redirect shape: the
login page it lands on answers 200 to every path". **The code never read `Location`.** An
http-to-https upgrade, an apex-to-www redirect and an SPA rewrite all produce that byte-identical
claim, so at a deploy refusal an operator would be told SSO when the cause might be routing. It now
prints the status and the target and leaves the interpretation open, and an arm fails if the old
diagnosis wording returns.

Two arms also asserted only the return code. `rc=1` for an asset behind the redirect is reachable
by two different routes (with `-L`, the landing page's content-type; without it, the bare 302), so
an rc-only arm could not see the transport property its own label named. They assert the message
now, which is what made the `-L`-drop mutation visible.

## The decision I made against my own work: the extraction guard stops widening

Iteration 11 of the challenge loop made a macro finding I accept. The handler-count and manifest
apparatus in `tools/test-served-verify.sh` is three layers deep: a guard on the documentation of a
fixture inside a test. It has been defeated seven times on this branch (a comment supplying a
token, a sed slice running to EOF, a count floor below the truth, a character class blind to a
digit, one of Python's two quote characters, one spacing of `==`, and prose standing in for
documentation), and the same reviewer demonstrated three further evasions that are still open:
`if self.path.startswith(...)`, `if p.endswith(...)`, and `if p in (...)`.

**The call: I did NOT close those three.** I made the scope sentence name what the regex actually
matches (a restriction on the METHOD, `.startswith(` or `==`, not on the subject) and stated in the
file that the widening stops there, by design rather than by oversight.

**What I rejected:** closing them. Each previous closure produced the next evasion, and what this
guard defends is the accuracy of a comment about a fixture. No product behaviour depends on it. The
file's own history is the evidence that the race does not terminate.

**Weakest premise:** that an undocumented fixture handler can only cause a stale comment. That
holds only so long as no arm selects a fixture path dynamically. If one ever does, an undocumented
handler could make an arm pass for the wrong reason, and the guard becomes product-relevant again.
That is what would change my mind, and it is named in the test file too.

**What I kept, because it is cheap and catches a real edit:** the exact `n_paths` equality, and the
manifest arm now made bidirectional (an entry for a handler that no longer exists used to stay
green). What I retired: a six-phrase overclaim denylist that the whole-refusal-line equality had
already subsumed, which emitted no `ok` line and had no control proving it could match anything.

## Known gap I did NOT close here, filed instead

`served_verify_host_discriminates` builds its negative control under `/dist/`, while
`tools/deploy-site.sh` also asserts `$HOST/setup`, a different route. A host that discriminates
under `/dist/` and is blind under `/setup` would pass the control and then be trusted for `/setup`.
It is equivalent for the deployment-wide SSO shape the card measured, and not equivalent for a
route-scoped blindness. It is pre-existing (the function arrived with kosmos#2268, not with this
branch), and changing the probe shape changes a verdict-bearing function that two other slices of
#1667 already depend on. Filed rather than changed here.

## Disclosure: a refusal can now print a credential-shaped value into the deploy log

The note prints the redirect target WHOLE, query string included, and `tools/deploy-site.sh` puts
that into the deploy log and the operator's terminal on every served-verify refusal. A live Vercel
SSO redirect lands on something shaped `.../sso-api?url=<deployment>&nonce=<...>`, so a failing
check copies a short-lived nonce, and whatever else a host chooses to put in a query, into that
output. It is not filtered, deliberately: truncating at `?` would hide the half of the target that
discriminates an auth redirect from a catch-all route, which is the whole point of the note.

That is the right call for a single operator's terminal and it is NOT obviously the right call if
this output ever reaches a shared or retained log. Whoever owns retention for the deploy log should
know a refusal can emit that value. Named here rather than only in the code comment, because the
code comment reaches the next person editing the file and not the person choosing where the log
goes.

## Weakest premise

I have not reproduced this against a real Vercel preview URL on this branch, and I will not: the
card's own instruments are the thing under test, and hitting a live host to prove a local guard
would be the scope error the card's second half is about. Everything here is measured against a
hermetic local server that reproduces the shape I recorded on 2026-08-31. If Vercel changes its
redirect target or status, the fixture is a model of the old behaviour and this plan is where
somebody should start.
