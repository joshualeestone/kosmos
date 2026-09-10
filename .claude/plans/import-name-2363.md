# import-name-2363: prepopulate the detected name on import (#8, Josh 0.6.40 re-test)

## The problem (#8)
Josh's 0.6.40 fresh-account re-test imported an agent file that shows "Pip" and the create
form's name input was left BLANK. Reproduced: the file was a CLAUDE.md whose intro is
role-first with the name in the H1 (`# Pip\n\nYou are a helpful assistant that ...`).
`identityFromText` (the strict "You are X" parser) returns null for that shape, so
`importFromInstructions` takes the #4 offer-to-name branch and returns `name:"",
displayName:""` -> both create-name and create-label render blank. The name "Pip" is right
there in the H1, just never extracted.

## The change
`engine/agentfile.js`: add `headingName(src)` - the file's first markdown H1 (`# Pip`),
bold-stripped, safeValue-guarded, MAX_DISPLAY-capped, skipping a heading that is itself an
intro line (`# You are X`, which identityFromText already handles). In the offer-to-name
branch (INTRODUCES matched, no clean displayName), if there is a usable H1, return it as
the prepopulated name (`name: suggestName(heading)`, `displayName: heading`) with
`needsName:true` kept (a best-effort from a heading is a prefill the person confirms, not a
settled parse). A file with no usable H1 falls through to the empty offer-to-name, unchanged.

## Verified
- engine: `# Pip` + role-first -> name "pip" / displayName "Pip"; `# Pip the Pigeon` ->
  "pip-the-pigeon" / "Pip the Pigeon". 33/33 import tests.
- front-end (self-boot repro): importing Josh's `# Pip` file now fills create-name="pip",
  create-label="Pip" (was blank). finishImport already maps data.name/displayName -> the
  form; the fix is that the engine now supplies them.

## Decisions
- **Engine, not a frontend fallback.** The detected name should have ONE source (the import
  parse), consumed by finishImport - a frontend H1-extraction would be a second copy of
  name-detection. Rejected the frontend-only fix.
- **H1 only; do NOT extract "named X" or lowercase intros.** The #4 offer-to-name cases
  (`You are angel`, `You are a senior engineer named Krang`) have no H1 and MUST stay
  offer-to-name (empty name) - existing #4 tests pin that. Extracting "named X" would break
  them and over-reach; the H1 is the conventional, unambiguous name location and the common
  real case (Josh's folder agents).
- **Keep needsName:true.** The prefill is best-effort (an H1 can be a title, not a name), so
  it stays flagged as confirm-me; the create form's name validation is the backstop. The
  person can edit it - offer-to-name intent preserved, just not blank.
- **Skip `# You are X` headings.** identityFromText handles those; treating the raw heading
  as a name would yield "You are X" as the display name. A test pins that it never leaks.

## Weakest premise
If Josh's actual file had NO H1 and named the agent only via "named Pip" (role-first, no
heading), this fix does not cover it (that path stays blank offer-to-name, to keep the #4
Krang case). Reproduced the H1 case as the most likely and most common CLAUDE.md shape; if
a re-test shows a no-heading "named X" file still blank, the follow-up is a narrower
"named X" extraction that does not also re-accept the Krang test's intent. Also grant-
independent: this is the import->form prefill, not the permission path, so it is fully
self-verified here and carries no mocked-grant caveat.
