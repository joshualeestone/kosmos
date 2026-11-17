# vercelretry-8656: the promote's site deploy survives Vercel's intermittent "Not authorized"

Card: #8656 (Splinter 15:3x 11-17). Owner: Baron Draxum.

## Measured
- Both prod promotes on 2026-11-17 (0.8.07 at 07:3x, 0.8.08 at 15:3x) hit "Error: Not authorized" (rc 77) at
  `deploy-site.sh --promote`; `vercel whoami` on Mortals answered the right account right after; a rerun of the
  deploy alone published both times.
- The cut has survived the same refusal since #7711 (site_vercel_deploy in tools/lib/site-deploy.sh): refresh the
  sign-in with `vercel whoami`, then up to 4 tries 60 s apart on exit 1 with "Not authorized". deploy-site.sh, which
  the promote path runs, called vercel once.

## Change
- deploy-site.sh, the non-terminal path (promotes, autodeploy): the deploy goes through site_vercel_deploy (#7711),
  with three rules of its own:
  - a try that made a deployment (an Inspect/Production/Preview URL in its output) is never tried again: it returns
    86, which site_vercel_deploy does not retry, and the run exits 1 ("failed (rc 1) after it had made a deployment");
  - before each retry the pointer freeze (#6620, `_ds_late_freeze_check`, now a function the first check also uses)
    and the live pointers (#5589) are read again: a freeze ends it with exit 1, a moved or unreadable pointer with 75,
    nothing deployed;
  - each try's output is shown as it runs (tee) and only the LAST try's is classified (77 vs 1).
  A person at a terminal keeps the CLI as before.
- Tests: test-deploy-site-promote.sh R1 (refused once, then published), R2 (refused every try: 77 after 4), R3 (a
  pointer moved before the retry: 75, one try), R4 (a freeze pushed during the wait: 1, one try);
  test-deploy-site-exit0-2791.sh B5d (a refusal after a deployment: 1, one try) and B5e (the same with a moved
  pointer: 1, never "nothing has been deployed"). Both stubs answer `vercel whoami` without publishing. R1 to R3 are
  red against main; B5d, B5e and R4 are red against this branch's first commit 70a2df6d84 (4 tries; 75 "nothing
  deployed"; a deploy over the freeze). exit0-2791 sets KOSMOS_VERCEL_RETRY_S=0 (its refused arms would wait 3 min).

## Cost, decided
- With an explicit VERCEL_TOKEN (the autodeploy's normal path) there is ONE try, as before: the retry's refresh
  (`vercel whoami`) renews the CLI's own sign-in, which a given token does not use, so retrying a refused token would
  only wait 3 min to say the same 77 (review 2). Test R5; red against ecfdb47f5e (4 tries).
- Without a token (the CLI's sign-in: both 11-17 promotes said "no VERCEL_TOKEN was given"), a box whose sign-in is
  truly refused now spends about 3 min retrying before 77, as a cut does.
- Weakest premise of the token rule: that a refusal of an explicit token is never transient on Vercel's side. If one
  is, the autodeploy shows a red tick and retries on its next one; no release is held by it.

## Weakest premise
That the refusal is the token-refresh race #7711 describes. Why Vercel refuses is still unknown; each try prints the
token's time left (site_vercel_token_left), so the next refusal can be read against it. Measuring that is the card's
second half.
