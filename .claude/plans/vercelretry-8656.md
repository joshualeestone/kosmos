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
- deploy-site.sh, the non-terminal path (promotes, autodeploy): the deploy goes through site_vercel_deploy, with a
  before-retry hook that re-reads the live pointers (#5589) and ends the run with exit 75, nothing deployed, if one
  moved. The output is still captured, so a refusal on every try still exits 77 with the #6771 sentence. A person at a
  terminal keeps the CLI as before.
- tools/test-deploy-site-promote.sh: the vercel stub answers `whoami` (it would otherwise publish there) and can refuse
  N times or move a pointer at a refusal. Three arms: refused once then published (2 tries); refused every try (exit 77
  after 4 tries, live untouched); a pointer moved before the retry (exit 75, one try, live untouched). All three are
  red against main's deploy-site.sh (one try, exit 77).
- test-deploy-site-exit0-2791.sh sets KOSMOS_VERCEL_RETRY_S=0: three of its arms are refused on purpose and would now
  wait 3 min (measured 244 s against main's 63 s; 62 s with the export).

## Cost, decided
A box whose token is truly refused (#6771) now waits about 3 min before exiting 77, as a cut does. The autodeploy
retries a 75 on its next tick and parks on a 77, so it only spends those minutes, once per tick.

## Weakest premise
That the refusal is the token-refresh race #7711 describes. Why Vercel refuses is still unknown; each try prints the
token's time left (site_vercel_token_left), so the next refusal can be read against it. Measuring that is the card's
second half.
