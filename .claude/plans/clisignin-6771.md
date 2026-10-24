# clisignin-6771 (kosmos): the site autodeploy deploys on the machine's vercel sign-in when no token is filed

Card: kosmos#6771. Asked by Splinter 10-22 17:55: "make #6771 not happen again".

## Why
Since 10-21 every site merge failed the autodeploy with "no Vercel token" (the refusal #6771's first fix added), and
two of Josh's homepage changes (the trailer, 388015850a; its controls, 2188c627d4) went out by hand from Mortals. The
cause the card names, Mortals' CLI sign-in "no longer authorizing", was measured wrong: the 10-20 17:43 "Not authorized"
was transient. This same job deployed 08b62e509 on that sign-in at 18:15 the same day (~/.kosmos-site-autodeploy/log),
and `vercel whoami` on Mortals answers joshualeestone-6084 today; two hand publishes on it worked at 17:4x and 18:0x.

## Decided
- **No token filed: deploy on the machine's own CLI sign-in when `vercel whoami` answers** (30 s limit), and say whose.
  The deploy then gets no VERCEL_TOKEN (deploy-site.sh uses the CLI's sign-in when none is given). Rejected: keeping
  the token-only rule, which made a missing credential a two-day site outage for every merge.
- **A filed token still wins**, and then whoami is not run. The token remains the better fix (a sign-in can lapse);
  the exact clicks for Josh are on the card.
- **Red only when neither works**, naming both ("no token ... and this machine's vercel CLI is not signed in").
  deploy-site.sh's exit 77 ("Not authorized") handling is unchanged.
- **Weakest premise:** that the runner job sees the same sign-in as an ssh shell. Evidence: it is the same user and
  HOME (the runner plist runs as mortalkombat; auth.json is in ~/Library/Application Support/com.vercel.cli), and this
  job deployed on it on 10-20 at 18:15. The first autodeploy tick after merge is the live test.

## Measured
- tools/test-site-autodeploy-5589.sh: ALL PASS, with 3 new arms (no token + signed in deploys with no VERCEL_TOKEN;
  no accessor + signed in deploys; a filed token wins and whoami is not run). The test never runs the real CLI: a
  stand-in that is not signed in is the default, so every earlier no-token arm is red as before.
- Review 1: whoami must exit 0 with exactly one name-shaped line (an error on stdout was read as a name), its stdout
  goes to a file (a child holding a pipe outlived the limit: measured 101 s for a 3 s limit), and arms for an error on
  stdout, two lines, a hang with a child holding stdout, and an exported empty token. Mutants: exit code ignored,
  no unset, a pipe instead of the file, no line count: 1 red each.
- Review 2: a limit of 0 falls back to 30 (perl's alarm 0 cancels it). REASONED, NOT TESTED: telling "30 s" from "no
  limit" needs a stand-in that hangs past 30 s, which this test will not spend. The accessor's reason is now said on a
  sign-in deploy (tested), and the exit 77 line names both fixes, a new sign-in or a token.
