# #8665 and #8666: an agent's model from the command line

Cards: joshualeestone/kosmos#8665 (show each agent's model in `kosmos agent list`) and #8666 (a command to view and set an
agent's model). Both split from #8662 (Kitty: a signed-out board tab shows every model as unknown, and its picker does
nothing). April has #8667, the board half. Assigned by Splinter 17:56 CST 11-17; one branch because they share a path.

## What finished looks like

- `kosmos agent list` on a real board names each agent's model in its card's words, and an agent with no recorded model
  reads the same as on its card.
- `kosmos agent model "<name>"` shows the agent's model and the models it can switch to; `kosmos agent model "<name>"
  "<model>"` switches it (a restart, as Switch & Restart does), through the board's own route and model check; an unknown
  model is refused with the list of valid ones; the board shows the new model afterwards. Both on the Mac and the Windows
  CLI.

## Decided

- **The card's words, computed by the board, not the CLI.** The list route's row carries `model`, from a copy of the page's
  tileModelLine over modelLine in engine/clilists.js (the CLIs carry that file alone, so it cannot require the page or
  cardlabel). clilists.modelline-8665.test.js runs the page's own functions, with the real CARD_ST table, on 14,040 cards (the
  page's 12 states plus one it does not know, by 10 model, 18 runner and 6 extra shapes)
  and asserts the same words. Rejected: a second wording for the CLI (it would drift from the card the person sees).
- **The model goes last on the line**, after the state, so a reader splitting the first three columns is unchanged; an
  older board's rows print as before.
- **Choices come from the engine, refused for setModel's own reasons.** setModel's checks (name, job, vendor, Qwen, Muse)
  moved into create.modelTarget, used by setModel and the new create.modelChoices, so the list and the switch refuse an
  agent for the same reasons. They can still differ on one model: an OpenAI account's menu folds dated snapshots that
  the route accepts (review 2). GET /api/agent/<name>/model serves it: Claude's menu less what the company
  policy does not allow; an OpenAI agent's from its own account (the same accountModels call as the board's picker, so the
  same "cannot list" sentences, and runnableKeys and the folder path never travel), also less what the policy does not
  allow (review 1: it listed them, so a policy-refused pick passed the CLI's check and the confirm and was refused only by
  the route); Gemini and Grok take any id (the route checks it).
- **The switch is AI Settings' own POST /api/agent/<name>/model**, as the person, after a confirm (or --yes), with a
  300 s wait as restart has. A model not on Claude's menu is refused with the list before anything is sent (that menu is
  all setModel takes); a model not on an OpenAI account's menu goes to the route, which takes any id the account runs
  (the menu folds dated snapshots, review 2). The startup job's own model sends nothing and says so, pointing at
  kosmos agent restart (what runs can differ until a restart, review 2). The full id works as well as the menu key (create.modelFor, #8618).
- **Never yourself.** A switch restarts the agent, so #8071's self-check applies. It moved into one function per CLI
  (_refuse_if_self, refuseIfSelf) that restart and model both call, rather than a second copy.
- **Behind the board token, like the switch.** The read is not added to the agent-token list: a token-only agent (Windows)
  still sees every model through `kosmos agent list`, and switching needs the person's token anyway.
- **No removed-agent refusal on the model route.** Unlike restart (#8071), the model route never starts a dead agent
  (no startIfDead), so a switch on a removed agent only rewrites its unused job. Left as the board already does it.

## Weakest premise

That the card's line is the right answer for a helping agent. It is the planned model for a stopped agent and the live one
for a running one; the command's list marks the model the startup job names, which can differ from the card's line for a
running agent until it restarts. Both are said in their own words, never merged.

## Coordination

April's #8667 changes modelLine's "Unknown Model" to "No model recorded: set it in AI Settings", and Kitty's #8662 adds a
signed-out line. Whichever merges second updates the other side; the parity test names the card that differs.

## Tests

- engine/clilists.modelline-8665.test.js (3, parity with the page; control: one changed condition fails 2 of 3).
- engine/clilists.test.js, server.agent-token-gate-4491.test.js, server.guide-hidden-3739.test.js: rows now carry model.
- server.switch-account-1373.test.js: 7 new route tests by round 7 (Claude menu, an OpenAI account that cannot list, Gemini free and
  the refusals equal to setModel's own).
- cli.agent-model-8666.test.js (13 by round 7, both CLIs against a stub board; controls: dropping the Windows self-check, and the Mac
  menu check, each turn a test red).
- cli.agent-restart-8071.test.js and cli.token-refused-5333.test.js still pass after the self-check moved (31/31).
- All cli.*, tools.windows-kosmos-cli* and engine/create* tests: 2312 pass, 0 fail after the usage pin in
  cli.agent-create-3734 was updated (round 0).
- Review 1: cli.agent-model-8666 gains an OpenAI menu with no ids (control: the Mac's old tab separator moves the set mark
  and goes red) and an empty Claude menu; server.switch-account-1373 gains the OpenAI policy filter (4 route tests).

## Review 1 (opus)

- [WARNING] the Mac read model rows with IFS=tab, which merges an empty id into the next field: an OpenAI row lost its set
  mark and "already set" never fired, so a switch to the current model restarted it for nothing. FIXED: \x1f separator.
- [WARNING] the OpenAI list was not filtered by policy, so the plan's "cannot disagree" was false. FIXED in the route.
- [NIT] an empty Claude menu used the OpenAI sentence. FIXED (split on kind and listed). [NIT] md_listed unused: now used.
- [NIT] a partial switch prints to stdout on the Mac and stderr on Windows: as agent restart does today; left.

## Review 2 (sonnet)

- [WARNING] the CLI refused an OpenAI snapshot id the route would take (the menu is collapsed). FIXED: only Claude's menu
  refuses a miss.
- [WARNING] "already set" was judged from the job while the running model can differ. FIXED: the words say the startup job
  names it and point to kosmos agent restart.
- [WARNING] the Mac matched the card's name without case only on a Mac; Windows always. FIXED: always.
- [NIT] a refused request (no ok) read as "cannot be changed", exit 0. FIXED: "could not say", exit 1, both CLIs.
- [NIT] no platform passed to modelChoices or setModel on the routes: both omit it, so they agree. Left.

## Review 3 (opus)

Confirmed unchanged by reading against origin/main: setModel for every provider and refusal; agent restart on both CLIs.

- [WARNING] Windows tested the untrimmed word for an option (" --foo" was sent). FIXED, and the Mac now trims the model
  word too (a padded "--opus" reached the board there).
- [WARNING] an agent that does not exist, and a read that threw, exited 0 as "cannot be changed here". FIXED: a list read
  whole that names no such agent says "There is no agent called X on this board", exit 1; the route marks a throw
  readFailed and both CLIs exit 1 on it. Not covered: on Windows, setModel's "we could not read X's startup task" is a
  refusal without a flag, so it still reads as "cannot be changed" (the engine words it; telling it apart needs the
  verdict carried out of noJobRefusal).
- [WARNING] nothing could fail if Claude's policy filter were deleted. FIXED: a route test stubs orgpolicy.allows, so the
  real policyAllows runs, and checks setModel refuses the same model (control).
- [CONVENTION] a repeated assertion: removed. [NIT] HEAD on the GET route asked OpenAI for nothing: GET only now.
- [NIT] left: a Claude model the policy forbids gets "not a model it can switch to" with the list, not the policy's own
  sentence; an OpenAI job on a dated snapshot gets no set mark (the route still takes the id).

## Review 4 (sonnet, ran about 26 inputs through both real CLIs against a stub board)

No BLOCKER, WARNING or CONVENTION; Mac and Windows agreed on every input but one wording.
- [NIT] control characters in a board's model key or label reached the terminal; a typed model with a line break was
  echoed across lines. FIXED on both CLIs (tested).
- [NIT] left: Windows says "Look at its page." with no address where the Mac gives one, as agent restart does on each
  today; a name with a quote prints an unrunnable hint (create's name rule refuses such a name); no What's new line (a
  CLI-only verb, for whoever writes the release notes to decide).

## Review 5 (opus, whole branch)

- [BLOCKER] the command took the name kosmos agent list prints ("Baron Draxum"), and the route refused it ("that is not a
  name we can act on", read as "cannot be changed here", exit 0), while the folder name read fine but then found no card.
  So show and switch disagreed for nearly every real agent, and the stub board answered any name, so no test could see
  it. FIXED: the read takes ?resolve=1 and resolves by kosmos#8109's remove.resolve over cardsForResolve, the same cards
  the list prints; it answers the agent's own name (switched, and compared by the self-check, as whoami names agents by
  it) and the card's shown name (to find its line); an ambiguous name is refused, exit 1; found:false only when no card
  answers. The switch is not resolved again (as remove's DELETE is not). The stub now resolves and refuses as the route
  does (control: switching by the typed name on Windows turns 2 tests red), and a route test drives the resolve wiring.
- [WARNING] the setup guide, hidden from the list, read as "no agent called". FIXED: "no agent" comes from the route,
  which resolves the guide by its exact folder; the CLI prints no card line for an agent the whole list hides.
- [CONVENTION] plan claims ("cannot disagree", a test count): corrected above. Commit history: squashed to two commits
  before the PR. The parity test's states: read from the page's CARD_ST, plus one it does not know.
- [NIT] the typed word raw in the confirm and "already names" lines: cleaned once. Left: no way back to a provider's own
  default from the CLI (the empty choice), an OpenAI dated snapshot gets no set mark, and the already-set read is a
  moment's (harmless: the route rewrites the job anyway).

## Review 6 (sonnet, whole branch)

Name resolution checked end to end by reading: every path switches and self-checks by the resolved name and matches the
card by its shown name.
- [WARNING] with the cards unreadable, a name as the list prints it was not resolved and came back as the name rule's
  refusal, read as "cannot be changed", exit 0. FIXED: that case is a read that failed (exit 1).
- [WARNING] the confirm named the typed word, not the agent that would restart (a folder name can be one agent's while
  the list shows another by that word). FIXED: when they differ, the confirm says "<shown> (<own name>)".
- [CONVENTION] the stub had no ambiguous or folder-collision case: added (CLI) and a route test for the unresolved name.
- [CONVENTION] plan: a removed agent with a job left is shown and switchable by its folder name, with no card line (the
  list hides it). Left: the switch never starts it (no startIfDead), and the show says what its job runs on.
- [NIT] left: kosmos agent restart still self-checks by the typed word, so a caller naming itself by display name slips
  past (unchanged from main; restart's route does not resolve names); a token-only Windows agent cannot use agent model
  (board-token routes, as said in help).

## Review 7 (opus, whole branch)

- [WARNING] the confirm named an agent by the typed word whenever that was its own name, so a word that is one agent's
  folder and another's display name read as the other (remove.resolve: the folder wins). FIXED: whenever the card's
  shown name differs from the agent's own, both are said ("Sal Folder (sal)"), on the card line and the confirm.
- [WARNING] control characters were stripped only from menu keys and labels; a job's model, a display name or a refusal
  could carry an escape. FIXED on both CLIs for every field the board sends (tested with set and because).
- [WARNING] neither card's "on a real board" is shown. True: only stub and in-process boards here. Each card is verified
  on a real board once this is served, before it closes.
- [WARNING] an OpenAI pick the route refuses came back with no list. FIXED: the menu it had is added.
- [WARNING] shown and found were never tested on real cards. FIXED: server.guide-hidden-3739 drives the route over a
  fleet board with a display name (resolves three spellings, and found:false for a stranger).
- [NIT] counts: corrected to 14,040 cards above, and seven review rounds. History: one commit for both cards.
- [NIT] left: with the cards unreadable, a valid lowercase name no agent has reads "not started by Kosmos", exit 0 on the
  show path (only the name-rule refusal is remapped); "already names" points an agent at restarting itself, which
  agent restart then refuses; agent restart still self-checks by the typed word (unchanged from main).

## Review 8 (sonnet, final, whole branch)

No BLOCKER or WARNING. Checked by test and by driving install/kosmos through a pty (y switches, n and empty send
nothing); agent restart and setModel read as unchanged from origin/main.
- [CONVENTION] stale test counts in this plan: corrected (route tests 7 plus 1 in server.guide-hidden-3739; 13 CLI tests).
- [NIT] the read was not refused to another website's page or another computer's page: now refused as the list route is.
- [NIT] left: the Mac's y/N confirm has no test in the suite (Windows's does; the Mac's was driven by hand in a pty); a
  removed agent with a job left is offered a switch (rewrites its unused job; never started); an OpenAI snapshot id equal
  to the job's model asks to confirm a needless restart.

Stopped at the 8-round cap, not converged (round 8 found nothing above NIT).
