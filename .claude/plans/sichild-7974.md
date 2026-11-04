# kosmos#7974: the family child-account advice behind one closed line on the Kosmos+ sign-in

Found building #7973 (Josh's Enterprise flow). Splinter: fix before McKinney.

## What was wrong
Every unmanaged computer's Kosmos+ sign-in showed #6873's full family paragraph under the email box ("Setting up a
child's computer? Sign in with your child's account..."). A computer under company device management hides it, but a
member joining with an invite code is unmanaged, and that is how a Windows member joins today (#7582), so a city
employee read family advice on the first screen of their first day.

## Finished looks like
- The sign-in shows one closed line, "Setting up a child's computer?", under the email box.
- Pressing it shows #6873's advice word for word (less the question, which is now the line); pressing again closes it.
- The email box is described by the advice (aria-describedby) only while it is open.
- A managed computer shows neither (the whole line hides, as the paragraph did).

## Call
A native `<details>` disclosure, closed by default. Rejected: hiding it for all but families (before sign-in Kosmos
cannot tell a parent), and rewording it (#6873's words are PigeonPete's decision). Weakest premise: that a parent
notices a one-line link; #6873's worry was a parent signing a child's computer in as themselves.

## Measured
- render-plus-signin-3478.js: four scenarios each assert the closed line, nothing described while closed, the advice
  and description once pressed, and closed again. All pass. CONTROL: against main's web/index.html the same check
  fails cleanly (12 failures). Found while writing it: inside a closed <details>, Chromium still measures the content
  18px tall (checkVisibility() is false), so the check uses page.isVisible, not its height-based visible().
- render-plus-company-5628.js: an unmanaged computer shows the line, a managed one does not. Pass.
- Shots: Files/shots-7974 (desktop and iPhone, light and dark).
