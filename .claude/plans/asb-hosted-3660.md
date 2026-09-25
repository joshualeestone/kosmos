# #3660: the setup assistant bubble on Kosmos's own model (the bubble side)

Josh, 2026-09-24 18:05/18:07: the assistant runs on Kosmos's own model until the person connects theirs ("let's do
it"). The server side is merged and deployed (ICK, kosmos-relay#115), and the Mac route is merged (#3674). The connector
with `assistant-chat` rides the 0.6.94 cut.

## Finished looks like
On an installed Kosmos with no guide agent yet, the bubble shows. It has the bundled picture of Josh, says it runs
on Kosmos's own AI until they connect theirs, and answers through POST /api/setup-guide/hosted. It carries the
conversation (session-long), says the allowance when low, and keeps the words in the box on a refusal. Once a guide
is made, the bubble moves to it. A connector that predates the verb (501) says so once and steps aside. A source
checkout and every browser-check sandbox show no bubble, as before.

## Decided
- Where it shows: GET /api/setup-guide says `hosted` only when a connector exists at a real path
  (remote.hostedAvailable), meaning the bundled copy or an explicit override. Rejected: always showing it without a
  guide. That would put the bubble on every browser check's page, and would send a developer's chat to the
  production coordinator.
- The conversation lives in sessionStorage for the tab. There is no agent thread to hold it, and it is not worth
  a board store: it is left behind when a guide takes over, since that is a different assistant.
- The screen goes with each question (the route keeps only the Screen line). The guide's /api/setup-guide/page
  report is skipped with no guide; its 404 would reset the bubble.
- The note says where it runs, because the words leave the Mac: "An AI in Josh's voice, on Kosmos's own AI until
  you connect yours. Josh isn't typing live."
- The allowance is shown only at 5 or fewer, so it is not a meter on every answer.
- The picture is served from the /icons allowlist as image/jpeg.

## Weakest premise
That the connector ships with the page. It does: it is in the same bundle (app/bin), and the 0.6.94 cut carries the
rebuilt one. A board on an old connector sees the 501 path once per session.

## Verification
- render-assistant-hosted-3660 (H1 to H12), with a fake connector and the route answered in the check. H12 asserts
  the fake never ran.
- render-assistant-bubble-3034 still passes (54), including B1's "no bubble without a guide" in a checkout sandbox.
- server.setup-guide-page-3034: `hosted` is false on a checkout board. hostedAvailable is covered in four arms
  (real file, missing, a bare name, a directory), and the picture route is checked (a JPEG, plus a 404 control).
