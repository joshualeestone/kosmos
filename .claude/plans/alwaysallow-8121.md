# alwaysallow-8121: stop asking to allow downloads from your own computer every launch (kosmos#8121)

Josh, 11-06 12:30 CST: "like always allow downloads from Kosmos or something". His ruling reverses #5167's deliberate
"Neither answer is permanent".

## Measured / read first (on the card)
- Asked once per computer per run: `mayDownload` keeps an Allow in memory and asks one question at a time per computer
  (the existing selftest row "A KOSMOS+ COMPUTER IS ASKED ABOUT ONCE" measures it). So "every time" is every launch.
- The app cannot tell which computers are the person's own: `isKosmosPlusURL` accepts any computer name under kosmosplus.com,
  and the app keeps no list of the account's computers.
- Every connect-mode launch loads the sign-in page first (it forwards to the computer), so "the app sees the sign-in page" is
  not a sign-out signal.

## Built
- The Allow question gets a third button, **Always Allow** (no key equivalent; Return still answers Don't Allow). Its text names
  what each answer does and the undo.
- Always Allow is kept per computer in the app's preferences (`kosmos.downloads.alwaysAllowedComputers`), read through the
  pure `keptDownloadHosts`: only Kosmos+ computer names by isKosmosPlusURL's own rule, never the sign-in host, at most 200, so a
  hand-edited or damaged preference cannot let any other site save files unasked.
- `mayDownload` lets a kept computer through, this run and after a quit. A plain Allow still lasts the run; a Don't Allow is
  never kept past a quit (nobody stuck on a misclick); an Allow voided by a page change is never kept.
- **Kosmos > Forget Always-Allowed Computers** clears the list (and this run's Allows), with a one-line confirmation. Added to
  the expected menu table in tools/build-kosmos-bundle.sh.

## Decided
- **Not "no question for your own computers"** (Splinter's first form): the app cannot know which computers are yours.
- **Never a blanket "always allow Kosmos"**: it would cover someone else's computer too. Per computer only.
- **Not dropped on sign-out**: the app has no reliable sign-out signal (the sign-in page loads on every launch). The undo is the
  menu item, named in the question. "Leaves the account" cannot be seen either. Stated on the card.
- Windows: this branch changes only the Mac app. Whether the Windows app (#7403's WebView2 path) asks a similar question was
  NOT checked here; to say on the card once read, not assumed.

## Weakest premise
That the person reads "Always Allow" as "this computer" and not "everything". The button sits beside the question naming the
computer, and the text says "for this computer"; a blanket answer does not exist to choose by mistake.

## Tests
`--kosmos-app-download-selftest` (+8, 47 rows), with the kept list in memory for the whole run, never on disk (reviews 1 and 2): Always Allow not asked again after a quit;
CONTROL a plain Allow asked again; a Don't Allow never kept; one computer only; Forget asks again; a tampered saved list keeps
only Kosmos+ computers; review 1: Forget clears this run's Allows without a quit; an Always Allow pressed on a changed page is void and not kept. The sign-in host is never offered Always Allow. Mutants: the kept check removed fails the first row; keeping before the page-changed check fails the void row. Menu table: live == expected.
