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

🛑 **THE SENTENCE THAT USED TO OPEN THIS SECTION WAS WRONG, AND THE BRANCH LATER DISPROVED IT.**
It read: *"The library is sound and I am not changing any verdict. Both tells are implemented ...
and `tools/deploy-site.sh` calls both before trusting a 200."* The first half holds. **The last
clause was false**, and it was the most important thing on the card: `deploy-site.sh` called the
negative control LAST, after every check it would have explained, so on a host-wide-blind host it
never ran at all. Left here as the record, because a plan that quietly edits away its own wrong
premise teaches nobody.

**What is true:** both tells are implemented in the library, media types are lowercased before
matching (so `Text/HTML` cannot slip through), and an empty content-type is refused. I also suspected the test
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

## What this branch changed in the PRODUCT (`tools/deploy-site.sh`)

Recorded here because it is the highest-blast-radius part of the branch: this file runs on every
production deploy of installkosmos.com, and for ten commits this plan did not mention it at all.

1. **The negative control now runs BEFORE the first read of `$HOST`**, not only after the deploy.
   On a host-wide-blind `$HOST` the first read returns the SSO page with a 200, `curl -f` does not
   fire, the pointer parse finds no `"artifact"`, and the old script refused with `latest.json
   names no artifact`: a symptom, and the wrong diagnosis. It now refuses before
   `vercel deploy --prod` rather than after, so it prevents rather than reports.
2. **The post-deploy control moved to the FRONT of the post-deploy block**, for the same reason one
   block over: it sat after `served_matches`, so a host that went blind between the two calls
   refused with "wrong bytes on the live site" instead of naming the mechanism.
3. **The Windows zip's `.sha256` is checked**, before the deploy in the export and after it on the
   served host. It was checked by nothing, twenty lines under a comment saying to check the pair.
4. **The UNVERSIONED Windows alias `kosmos-win-x64.zip` and its sidecar are checked.** `$WINZIP`
   defaults to a name thirteen versions stale (0.6.24 against latest-win.json's 0.6.37), so every
   check keyed to it guarded an obsolete artifact while the download users actually fetch had no
   check at all. The alias does not go stale on a version bump. Deriving the name from
   `latest-win.json` is the real fix and is **carded as kosmos#2571**.
5. **`package.json` lints both `#!/bin/sh` files with `sh -n`, not `bash -n`.** That is right but
   unarmed on macos-latest, where `/bin/sh` IS bash 3.2.57, so the arming lives in the test as a
   machine-independent bashism-token matcher plus a probed strict parser.

**Measured against production before shipping any of it**, so none can refuse on something that was
never served: installkosmos.com 404s a path that cannot exist; `/dist/$WINZIP`, the alias, both
sidecars, `latest-win.json` and `/setup` all serve with non-html content types.

**Weakest premise of the deploy changes:** the pre-flight control adds one request to every deploy
and refuses on rc 2 (transport error) as well as rc 1. On a flaky network that turns a transient
failure into a refusal BEFORE anything is deployed, which I judge to be the safe direction. If
deploys start refusing spuriously, that is the line to look at, and the fix is to distinguish rc 2
from rc 1 there rather than to remove the check.

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

## kosmos#2565: filed here, then IMPLEMENTED BY SOMEONE ELSE ON MAIN, and mine was dropped

`served_verify_host_discriminates` built its negative control under one route (`/dist`) while
`tools/deploy-site.sh` went on to trust a 200 at the site root (`/setup`). That is sound for the
deployment-wide SSO shape #1667 measured, where every route goes blind together, and not sound for
a route-scoped blindness: a rewrite rule, a catch-all, or an SPA fallback under one prefix produces
exactly a host that discriminates under `/dist` and answers 200 to everything at the root.

🛑 **THE HONEST HISTORY, because an earlier version of this section said "Closed here, additively"
and that is FALSE.** I filed it rather than fixing it. Two reviewers then raised it, so I
implemented it in-branch. **I never re-checked whether anyone had taken the card, and someone had:**
PR #2572 landed kosmos#2565 on main first. When I merged main, my version was dropped for theirs.

⭐ **THE RULE THAT COST ME: if you file a card and later decide to do it yourself, check whether it
is still yours before you build it.**

**Theirs is better, on the axis that matters.** Main takes `${2:-/dist}` and NORMALISES the route
(one leading slash added, all trailing slashes stripped), so a caller passes `/` for the root.
Mine used `${2-/dist}` and required an explicitly EMPTY string, and I had written both an arm and a
mutation to defend that fragility. Main also names a residual I had missed: a blindness scoped to an
EXACT literal path is unreachable by ANY negative control in principle, because no other path routes
identically to an exact match, so there is nothing to probe.

⚠️ **AN EARLIER VERSION OF THIS SECTION ALSO CLAIMED "a mutation swapping `${2-...}` for
`${2:-...}` reds the arm". A reviewer ran exactly that mutation after the merge: the suite exits 0.**
No arm passes an empty prefix any more, so none can red on it. That sentence was true of code that
no longer exists, which is the same defect class this branch has been removing all day, committed
in the file that records the removals.

**What this branch still contributes to #2565's area**, verified by mutation after the merge:
- an arm for the TRAILING-SLASH half of main's normalisation, which had none. `deploy-site.sh`
  passes `/`, so the strip is what makes the production root probe `${HOST}/__...` rather than
  `${HOST}//__...`. Measured before adding it: neutralising the `while` loop left the suite green
  while neutralising the leading-slash `case` red one arm. The refusal already prints the
  constructed URL, so asserting the URL is what makes the strip observable.
- an arm fetching main's `/routeblind` `/dist/real.bin` branch, which no arm reached, so it was
  dead fixture code. It is also the honest control for the route arms: the route-blind host is
  blind at the ROOT, not broken everywhere.
- 📌 the fixture is `/routeblind`, with NO trailing slash, and its root branch serves **text/plain**,
  not text/html. Both are deliberate and an earlier version of this section got both wrong: a
  no-trailing-slash handler is what makes the leading-slash-normalisation arm non-vacuous, and
  text/html at the root would be caught by `served_verify_asset_ok`, which would hide the fact that
  only the ROUTE control catches this shape.

## kosmos#2566: I was wrong, and Mona Lisa's third option is the right one

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

⚠️ **And naming it in two documents was still not enough, which is the correction worth keeping.**
A later reviewer pointed out that a disclosure with no tracked card relies on someone reading this
file, and the person who needs it (whoever owns deploy-log retention) has no reason to open it.
**Filed as kosmos#2566.** Where a decision needs an audience outside the branch, the card IS the
delivery mechanism and a plan section is not.

🛑 **AND THEN THE CARD DID ITS JOB ON ME.** Mona Lisa picked it up, measured two things I had not,
and returned a call I accepted:

- **My framing was the error.** I had treated it as redact-or-keep and kept, because truncating at
  `?` loses the discriminating half. **Redacting query VALUES while keeping query KEYS is a third
  option**, and it is strictly better: the tell is the host, the path, and which keys are present.
  The values are payload. `.../sso-api?url=<redacted>&nonce=<redacted>` is as diagnostic as the
  whole target and leaks nothing.
- **The measurement that settles it is one I never made.** A deploy on this fleet runs inside an
  agent session, and those transcripts are RETAINED on disk. My own card said the call was right
  for "a single operator's terminal" and not obviously right for a retained surface. The retained
  surface is the actual one.

**Implemented here** (her POSIX-sh form, run through this branch's loop and mutation-verified: with
the redaction removed the secret appears and the arm reds; with it over-applied the keys vanish and
a different arm reds).

⚠️ **An interaction only visible from inside the branch, recorded because it would otherwise be
blamed on the wrong change:** the printf-vs-echo arm, this branch's headline fix, drove a fixture
whose `Location` was `/ssologin?a=\tb\cTRUNCATEDMARKER` and asserted the marker survived into the
note. That marker sat in a query VALUE, so the redaction removed it and that arm went red. The
escape marker moved into the PATH, where redaction does not reach and a backslash is just as legal
and just as hostile.

⚠️ **RESIDUALS, named not fixed.** A credential in a PATH SEGMENT is still printed whole; redacting
path segments would destroy the tell, which is the same objection that killed truncation. A
VALUELESS query or fragment component is likewise kept, because it is indistinguishable from a KEY
and keys are the discriminating signal.

🛑 **AND THE USERINFO WORK, WHICH THIS SECTION DID NOT MENTION AT ALL UNTIL A REVIEWER SAID SO.**
`_served_verify_redact_userinfo` is the newest product change on the branch and it exists because
the residual list above once claimed to be COMPLETE while omitting the one URL component that is
always a credential. Measured: a `Location` of `http://alice:SECRETPASSWORD@host/p?tok=Q#frag=F`
had its query and fragment redacted correctly and its PASSWORD printed whole.

Its own first version then leaked too, and the second review caught that: it tested the text before
the FIRST `@` for a `/`, which is not the same question as "is the `@` before the path", so
`http://user:pa/ss@host/p` was not redacted at all. Userinfo ends at the **last** `@`, and taking
the first also displayed the wrong host on `http://user@host@evil/p`, the domain-confusion shape.
It now branches on the RFC authority, and every branch is pinned by a direct table rather than by
an end-to-end arm, because the adversarial shapes CANNOT be driven end-to-end: curl refuses to
connect to them, so the caller takes the transport branch and the note never runs.

⚠️ **Its own residual, and the first statement of it was narrower than the behaviour:** a target
whose authority contains a `:` (an explicit port **or an IPv6 literal**) and whose path contains an
`@` over-redacts and loses the host. Safe direction, not a shape this infra produces, and both
forms are pinned as table rows so the sentence and the code cannot drift apart again.

## The one load-bearing claim on this branch with no instrument behind it

Three pre-deploy gates refuse the deploy if the `git archive` of the site checkout does not carry
`kosmos-win-x64.zip`, its `.sha256`, or `$WINZIP.sha256`. **They fail closed with a clear message,
and their premise is a hand measurement, not a check.** No suite here touches `chaoskosmos-site`,
so nothing in this repo can re-verify it.

Re-measured 2026-09-09 10:22 CDT against the live checkout at `c0d7344`, working tree clean, asking
git what a `git archive` of HEAD would actually carry:

```
$ for f in dist/kosmos-0.6.24-win-x64.zip dist/kosmos-0.6.24-win-x64.zip.sha256 \
           dist/kosmos-win-x64.zip dist/kosmos-win-x64.zip.sha256; do
    git -C ~/work/chaoskosmos-site cat-file -e "HEAD:$f" && echo "TRACKED $f"
  done
TRACKED dist/kosmos-0.6.24-win-x64.zip
TRACKED dist/kosmos-0.6.24-win-x64.zip.sha256
TRACKED dist/kosmos-win-x64.zip
TRACKED dist/kosmos-win-x64.zip.sha256
```

⚠️ **That is a SNAPSHOT of one repo at one commit, and it is the weakest thing on the branch.** If
any of the four leaves that checkout, every production deploy refuses before deploying. It is the
safe direction and it is loud, but it is not instrumented.

✅ **kosmos#2571 is what turns it into an instrument**, which is a better argument for that card
than the one I filed it with: deriving the Windows artifact from `latest-win.json` makes the
`$WINZIP` check a real pointer-versus-committed integrity check instead of a name nobody updates.
Baron Draxum has picked it up. **Sequencing agreed 2026-09-09 10:22 CDT: he builds #2571 on
`origin/main` now and rebases onto merged #1667**, because #1667 has no merge date I can promise
(seventeen iterations, no quiet run) and this block is still being changed by reviewers, so
stacking his branch on mine would buy repeated rebases onto a moving target. I owe him notice if
that block changes again, and notice when #1667 merges.

## A bare-status surface this slice did NOT convert, and why

`deploy-site.sh`'s pre-deploy `fetch` / `verify_sha` sequence still uses `curl -fsSL` on `$HOST` and
is not routed through `served_verify_asset_ok`. Named rather than changed, for two reasons. It is
pre-existing and outside this slice, and more importantly it is **not actually blind**: `verify_sha`
compares the sha256 of the fetched bytes against a fetched sidecar, which is a CONTENT check and
strictly stronger than a status check. On a blind host both fetches return the login page, the
sha of the page will not match whatever `awk` scrapes out of the other copy of the page, and it
fails closed. What it gets wrong is the REASON, not the verdict, and the pre-flight negative control
now runs before any of it and names the mechanism first.

## Weakest premise

I have not reproduced this against a real Vercel preview URL on this branch, and I will not: the
card's own instruments are the thing under test, and hitting a live host to prove a local guard
would be the scope error the card's second half is about. Everything here is measured against a
hermetic local server that reproduces the shape I recorded on 2026-08-31. If Vercel changes its
redirect target or status, the fixture is a model of the old behaviour and this plan is where
somebody should start.
