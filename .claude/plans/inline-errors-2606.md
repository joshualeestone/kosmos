# kosmos#2606 - Create Agent / Create Project: inline, field-level validation errors

## The defect (Josh's product review, 2026-09-09, on 0.6.50)
On the Create an Agent page, form-validation errors are not surfaced inline. When submit
fails the page "refreshes quickly" with no clear signal; the only feedback is small text far
below the Create agent button (e.g. "use letters, numbers, hyphens and underscores, starting
with a letter or number"), easy to miss. Josh spent time confused before spotting the hidden
hint. Same structural defect as #1303 G (a reason placed AFTER the button you press, off
screen once the form scrolls), one form along. Asked to cover BOTH Create Agent and Create
Project.

## Approach
Put the reason AT the field, reusing the existing shared helper `pjFieldBad`/`pjFieldOk`
(web/index.html) that #1303 G already established for the project description field - red
border + message beside the field + focus/scroll. The helper is form-neutral in behaviour;
its `pj` name is kept only because a test lifts it by name and the project forms call it.

### Engine (engine/create.js)
- The name refusals carry `field: 'name'` so the page can route them to the name field.
  The refusal SENTENCE stays the server's - the form deliberately keeps NO client-side copy
  of the name rule (documented at the form, #2605 owns the rule), so this only says WHERE the
  message goes, not what it says.
- Tagged: the `nameProblem` char/length/format refusal AND every name-COLLISION refusal - on
  the removed list, an existing agent (folder+job), a job left behind, a launchd service still
  loaded, a folder left behind, and an already-running session. They are all "pick another
  name" refusals.
- NOT tagged, deliberately: the fail-closed "we could not check which agents are already
  running" refusal. That is a SYSTEM failure (tmux unreachable), not a name known to be taken,
  so flagging the name field red would mislead; it stays in the below-button message.

### Create an Agent (web/index.html)
- New `.ferr` slots `#create-name-err` (under the Name field) and `#create-label-err` (under
  the Role field).
- Submit handler: a server refusal tagged `result.field === 'name'` routes to the name field
  via `pjFieldBad`; the empty-Role client gate flags the Role field instead of writing below
  the button + hand-rolling focus. Untagged refusals stay in the below-button `#create-msg`
  (e.g. account/model/OpenAI-runner - not about one field).
- Field errors cleared at submit start, on form open (`openCreate`), and on input (so the red
  border tracks the fix).

### Create a Project (web/index.html)
- New `.ferr` slot `#pj-name-err` (under the Name field).
- Submit handler: an empty-name pre-check catches the commonest refusal at the field before
  the round trip (empty is unambiguous; the char rule and length cap stay the server's). The
  catch routes a server name-RULE refusal to the name field, matched on the specific name-rule
  sentences projects.js throws (give-a-name / not-words / too-long / too-many) rather than a
  broad `/name/i` - a folder-collision refusal interpolates an existing project's TITLE, and a
  title containing "name" would false-match `/name/i` (iteration-4 review). Checked AFTER the
  `/description/i` branch so a both-mentioning message still routes to description; a coupling
  test pins the regex to projects.js's messages and proves a folder collision does not match.
- Cleared on open (`openAddProject`) and on input.

### CSS
- The `.bad` red-border rule reached only `.tk-inp`. Broadened to `.frow input.bad` too, so
  the agent name/role and the project name (plain `.frow` inputs) actually paint red when
  flagged.

## Scope decision: on-blur
The card asks for "on submit (and ideally on blur)". Submit is delivered. On-blur validation
of the NAME char-rule is deliberately NOT added: the rule is server-owned (no client-side
copy), so a blur check would have to duplicate it - against the form's stated design. Instead,
clear-on-input gives live feedback (the red border clears as the user fixes the field), and
submit surfaces the server's reason at the field. A focus-stealing blur variant was rejected
as worse UX (pjFieldBad focuses, which is right for submit where the field may be off screen,
wrong for blur where the user has deliberately left the field). Emptiness-on-blur for the
required fields is a possible small follow-up if wanted.

## Tests
- New `web.inline-errors-2606.test.js`: the three `.ferr` slots exist; the `.frow input.bad`
  CSS; the engine `field: 'name'` tag; agent routing (name refusal → name field, empty-role →
  role field, resets); project routing (empty pre-check + `/name/i` after `/description/i`);
  resets on open + clear-on-input.
- `web.desc-error-1303g.test.js`: pointer-site counts updated (pj-create 2→4, total 5→7) for
  the two new project field-refusal paths, which each also set the generic below-button
  pointer as that test's invariant requires. Description-branch slice widened past the grown
  handler.
- Full node suite green (5555/5555).

## Not touched
- The role CHIP picker refusal stays below-button (it is a chip selection, not a text field
  with a slot; already client-gated).
- The project parent refusal stays below-button (no `pj-add-parent-err` element by design,
  #2458).
- The prod alias / channel machinery - unrelated.
