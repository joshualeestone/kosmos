# kickhold-6305: the site-deploy backstop respects a site-deploy hold on its own (kosmos#6305)

Filed and claimed by Angel at 07:2x CDT on 2026-10-16, at Splinter's suggestion. At 07:25 Splinter called a SITE-DEPLOY HOLD while 0.7.51 was promoted. The backstop from #6266 knew nothing of holds, and was held only because I unloaded it by hand.

**Finished looks like:** with the hold set, the kick asks for nothing and says why; with it cleared, the kick behaves as before; a hold that cannot be read counts as held; and the release runbook says how to set and clear it.

## The call
- **The hold is the repository variable `SITE_DEPLOY_HOLD` on the site repo,** set to a reason. Setting and clearing it is one `gh variable set` or `gh variable delete`, from any computer.
  - Rejected: a marker file, which Splinter suggested. The kick runs on Mortals and a promote can run anywhere, so a file only works when both are on the same machine.
  - Measured first: the kick's login on Mortals CAN read the site repo's variables. Listing them answers (0 so far), and a missing one answers 404.
- **The check comes right after the existing local pause file, before any other read.**
  - Set: the tick's line is `held: <reason> (SITE_DEPLOY_HOLD on <repo>); nothing asked`, exit 0.
  - Absent (a 404): no hold.
  - Any other failure (credentials, timeout, gh missing): treated as HELD, exit 1, with the gh reason. A missed deploy waits fifteen minutes; a deploy during a promote is the harm.
- **docs/releasing.md** has the set and clear commands before the "Before any promote" steps.

## Not built
- **The site's own deploy workflow does not read the variable yet** (the card's optional item). A push-triggered site deploy is NOT held by this; only the backstop is. The site repo is a separate PR, and the release flow's own cut detection already skips push runs during a cut.
- **The promote script (`tools/promote-channel.sh`) does not set or clear the variable itself.** That is a manual step in the runbook. Automating it means the promote script holds a gh login with variable write, which is a bigger change than this card.

## Weakest premise
That the person promoting reads the runbook step. If not, the hold is not set and the backstop behaves as before this change: no worse than today.

## Tests (`tools.site-deploy-kick-6266.test.js`, the fake gh gains the variable call: absent by default)
- held: nothing dispatched, the reason in the line; control: the same tick with no hold dispatches;
- unreadable (401): nothing dispatched, exit 1, "treated as held";
- the hung-gh and missing-gh tests now meet the hold read first, and their expected lines say so;
- mutants: removing the hold check, and treating an unreadable hold as clear, each turn a test red;
- 20/20 pass; `bash -n` passes on the kick.

## After merge
Reinstall on Mortals (`tools/install-site-deploy-kick.sh`) only AFTER Splinter lifts the current hold. The job is unloaded until then, and the installer would load it.

## Review notes
- **Review 1 (sonnet).** Four warnings, all fixed:
  - a silent gh failure (exit 1, no words) read as a set hold with exit 0, so set or not is now the read's own status (`hold_ok`), with a test;
  - an unreadable hold idles the backstop until the read works, and the tick's line and the runbook now say so;
  - a 404 can also mean the repo is invisible to the token (commented: the next read fails the same way, so nothing is asked);
  - the runbook said "hold automatic site deploys" while a push still deploys, so it now says only the backstop is held, not to push during a promote, and how to see a hold (`gh variable list`).
  - Nits taken: a reason with line breaks stays one line (test); the hold is in the kick's header list.
