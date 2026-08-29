# firstrun-live-874: the first screen stops claiming a connection it never checked

## What a real person hit

Josh's sister, 2026-08-29, first outside install. The first-run screen showed a green
"Connected" tick while she was **signed out**. She trusted it, found Settings disagreeing,
and used "add a provider" as the only route she had, which **made a duplicate account**.

## Why the file is not evidence

`subscription.check()` returns CONNECTED whenever `oauthAccount.organizationType` names a
paid plan (`subscription.js:169`). **A logged-out person still has that field.** So the
verdict was not "we could not check"; it was a confident wrong answer.

## The correction to the standing diagnosis

**Claude accounts ARE verified live.** `engine/accounts.js:279` has always called
`subscription.checkLive()`, which is exactly why Settings got the right answer. The earlier
"0 HTTP calls in accounts.js" measurement was true and misleading: it **delegates**.

⇒ Never a missing capability. **Two routes, two answers, and the louder one was cached.**

## And nothing on that screen had EVER checked live

```
engine/firstrun.js:119   subscription.check()      CACHED
frRecheck()              re-fetches /api/first-run  same cached call
```

**"Check again" re-read the same file** and returned the same wrong answer, confidently.

## The change

`firstrun.state()` uses `checkLive()`, and becomes async. `server.js` awaits it in the
`.then()` form its neighbours (`github.state()`, `vercel.state()`, `cloudflare.state()`)
already use.

**Josh's 09:27 green check survives**, because a live-verified connection still earns it.

## The subtlety that would have shipped a quiet regression

`checkLive()` returns `plan: null` **on purpose** (`claude auth status` says "max" where
`check()` says "claude_max", and that module declined to map them). The screen renders
`(sub.plan || 'A Claude subscription') + ' is connected'`.

⇒ Taking the live answer alone would have **downgraded "Claude Max is connected" to the
generic sentence for every paying customer.** So the STATE is verified live and the PLAN
NAME still comes from the file, shown only on the arm the live check confirmed.

## Cost, weighed rather than waved past

One `claude auth status` per first-run repaint. That route **already** shells out via
`fleet()` -> `status.paneRoster()` -> `tmux list-panes`, so this is its second subprocess,
not its first. Settings pays the same price on every open. `server.js:1702`'s five-second
status tick keeps `checkCached()` and is untouched.

## Perturbed

Revert to the cached check: the #874 test goes red. Drop the plan merge: **two** tests fail,
including a pre-existing one, so the merge is load-bearing. Suite 2944 pass.

## NOT fixed by this

**The card's first defect is untouched:** an agent whose token is 401ing still shows
"working..." in the chat with no error. That is a different surface and needs its own fix.
