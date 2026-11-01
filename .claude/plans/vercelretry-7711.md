# vercelretry-7711: a refused vercel deploy does not cost a cut (kosmos#7711)

## Problem
`vercel deploy` in step 8 answered "Error: Not authorized" on 0.7.69, 0.7.77 and 0.7.79, each after a full cut, and each cost a re-cut of about 2 h 40 min.

## Why it refuses
Mortals' sign-in is an 8-hour OAuth token the CLI refreshes just before its next request. On 0.7.79 and on 10-21 (#6771), the refusal and the auth.json rewrite fall in the same minute. Why Vercel refuses a deploy on a token just minted is not known. 0.7.77 and 0.7.69 have no timing to compare.

## Call
`site_vercel_deploy` in tools/lib/site-deploy.sh runs `vercel whoami` first, so a refresh happens on a call that cannot fail the cut, then runs the deploy and tries again on "Not authorized", up to 4 tries, 60 s apart. Any other failure returns at once, into #5471's landed check as before. Each try prints the token's time left, so the next refusal can be read against it. release.sh keeps its literal deploy line in `_vdep_once`, which three structural tests anchor on.

## Rejected
- Retry alone: it would work, but the whoami removes the likely cause and costs a second.
- A long-lived VERCEL_TOKEN: it may be the better end state, but it needs a token only Josh can create.
- Changing the site autodeploy: it retries on its next tick already.

## Weakest premises
- That the refresh is the cause. Two of four refusals have timing. If it is something else, the retry still covers it unless the refusal lasts longer than three minutes.
- That "Not authorized" means nothing was uploaded, as the card says. A retry after a partial upload would only re-upload.
- That the token cannot expire mid-upload and be refused then. A refresh during the deploy is not prevented by the whoami, but the retry covers it.

## Verification
tools/test-vercel-refusal-7711.sh with a stub vercel; test-deploy-landed-5471, test-pointer-freeze and test-setup-floor-6149 unchanged. A real refusal only happens on a real cut.
