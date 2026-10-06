# pausebtn-5391: a project Pause / Resume on the project itself (kosmos#5391)

Josh (08:13, via Splinter): options for where the project Pause / Resume goes, mocked at the project header, the Projects list card and the phone, posted with a pick, then built.

Built:
- A: a Pause / Resume button beside the project's name (#pj-head-pause, painted by paintHeadPause with the page), and a Paused line under the name (#pj-one-paused). The pick.
- B: a "Paused" badge on the project's card (pjPillOf), below Issue and above Working. Josh's call: it bends #4730's "only a badge if something is running". Ships unless he says "no badge", then it comes out in one commit.
- C: the phone gets A's button at touch size.
- One toggle, pjTogglePause, for this button and Settings' Pause it / Resume it: the same PUT /api/project/<id> {paused} (#4771) the chat pause (#5320, Baron) uses.

Tests: web.project-pause-head-5391.test.js; an arm in render-onhold-4771.js; screens project-head, project-paused, projects-paused in mobile-shots.js (shots: ~/work/design-shots/kosmos-5391).
