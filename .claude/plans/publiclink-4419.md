# #4419: the public Kosmos+ link for a webhook (stacked on #1307)

## Finished looks like
- On a Kosmos+ computer whose running connector admits webhooks, making a webhook shows TWO links in
  the same one-time reveal: the local one (as #1307) and `https://<name>.kosmosplus.com/hooks/<id>/<secret>`,
  each with its own Copy. Same id and secret; the board checks the secret as it does locally.
- With Kosmos+ off, or a connector that does not admit webhooks, no public link is shown, and one line
  says why ("works for programs on this computer ..."), so a link the connector would refuse is never shown.
- A webhook made before this ships has no public link (the secret was never kept); making a new one does.

## How the screen knows the connector admits webhooks (agreed with Baron, #4419 comments, 2026-09-28)
- relay#195 writes `admits_hooks` into the status JSON the board already reads (`--status-file`), on
  every status write, computed from the tunnel's own `proxy::admitted_hook` on a canonical hook POST.
- engine/remote.js `status()` reports `admitsHooks: raw.admits_hooks === true` when up. Only a real
  `true` counts: an older connector never writes the field, and the text "true" is not true.
- The status file is the running connector's (pid-checked, removed on stop), so this describes the
  running connector, not an installed one.

## Server
- `hookPublicLink(id, secret)` in server.js, above the webhook rate-limit notes: public link only
  when Kosmos Plus is on, signed in, `status().state === 'up'`, `admitsHooks === true`, and the
  address is a dotted host name whose last label is letters (HOOK_HOST_RE: no IP literal, no path);
  lowercased. Otherwise `publicWhy`, one true sentence per cause, keyed on the setting and the
  sign-in, not on the tunnel's state alone: the settings unreadable (say so); the switch off (Kosmos Plus can also give a link, no promise it will); on but not signed in
  (finish signing in); connecting or restarting (make a new one once connected); on but not
  running for any other reason (not connected right now); an older connector (does not take
  webhooks from the internet yet: no promise of an update, which nothing here can check); an
  address we could not read. The make route returns `{ webhook, url, publicUrl, publicWhy }`.
- Page: when both links show, each has a label ("On this computer", "From the internet"), its own
  Copy with its own accessible name, and the copied line says which link was copied.

## Settings hint
The fixed hint above the list no longer says the link works only on this computer (#1307 had it): with two
links it contradicted the internet one. The one-time reveal owns reachability, one true sentence per cause.

## Rejected
- A connector version table: drifts, and a version names a range, not a build.
- Probing the public URL: a call per make, and cannot tell a refusal from an outage.
- Showing the public link on existing webhooks: impossible (only the hash is kept); a new webhook is the way.

## Tests
- engine/remote.test.js: the fake connector writes admits_hooks true / absent / "true"; only true reads true.
- server.webhooks-1307.test.js: up+admits gives the https link with the same id and secret; an old
  connector, Kosmos+ off, and a non-host address give none and say why; the local link is there in every case.
- web.webhooks-1307.test.js: the revealed row shows the internet link (escaped) with its own Copy, else the reason;
  each Copy copies its own link and says which (and just "Copied." when there is one link).
- docs/browser-checks/render-webhooks-1307.js: off shows the reason and no internet link; up (remote stubbed in
  the check's own process) shows both links, labelled, with their own Copy names, fitting at 390 wide.

## Weakest premise
That relay#195 ships the field exactly as agreed (`admits_hooks`, boolean). If it lands under another
name, this shows no public link anywhere (the safe direction) until the one line in remote.js changes.

## Merge order
#1307 merged (PR #4453, 0e88cfd); this branch is its own commits on main.
