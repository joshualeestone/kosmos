# modelid-4111: a model id in a secrets file is not held (kosmos#4111)

## Problem
engine/knownsecrets.js holds every key-shaped value in a file under secrets/. A model id (gpt-4o-mini-2024-07-18)
has digits and no words, so `OPENAI_MODEL=gpt-4o-mini-2024-07-18` made it a held secret, and the guide mask then
masked the setup guide's own prose naming the model (found in #3995 gap-4 review round 25).

## Design
- parseAssignment(line) -> {name, value}; assignedValue wraps it (one parser, as before).
- isPublicName(name): a NAME with a public part (MODEL, MODELS, REGION, VERSION, ZONE, LOCALE, LANG, LANGUAGE, TZ,
  TIMEZONE) and no secret-like part (KEY, TOKEN, SECRET, PASSWORD, PASS, PWD, AUTH, CREDENTIAL(S), PRIVATE, SIG,
  SIGNATURE, SALT, COOKIE, SESSION, DSN, CERT, PEM, APIKEY).
- valuesIn: for a public assignment, hold NEITHER the line NOR its value (and not a one-line file that is one). Both
  must go: secretmask's isEnvLine walks a NAME=value line whose value is not held, which would mask pieces of it in
  prose. Other key-shaped tokens on the line (a key in a trailing comment) are still held.

## Rejected
- URL, HOST, ENDPOINT as public parts: a URL can carry a token or password; holding one costs only a masked address.
- A model-id SHAPE list (gpt-*, claude-*, gemini-*): goes stale with every new vendor and would un-hold a real key
  that happens to start the same way. The NAME is what says the value is configuration.

## Weakest premise
What is dropped is a piece of a value under a public NAME that is ALSO configuration-shaped (one case, cut by - or .,
not only hex). So a secret that is lowercase-or-uppercase, dash-separated and non-hex (zq8v-lm3p-rt6w-xy9k), stored
under a NAME ending in MODEL/REGION/VERSION/..., is no longer held by value. Any mixed-case or hex secret under a
public NAME is still held (round 5 narrowed it from "every piece of the value" to this).

## Tests
- knownsecrets.test.js: public values not held (env, export, YAML, JSON, one-line file); controls: OPENAI_API_KEY and
  MODEL_API_KEY held; a key in a comment on a public line held. isPublicName table.
- secretmask.test.js: end to end through collect -> setKnownSecrets -> mask: three sentences naming the model are
  untouched; the key beside it is masked.
- All three red on origin/main's knownsecrets.js. Perturbation (hold the line, skip only the value) turns the end-to-
  end test red: the walked-line trap is guarded by the behaviour test, not only by the collector test.

## Challenge loop record
### Iteration 1 (opus): 3 WARNINGs, 3 NITs, all fixed.
- W: exact-equality exclusion missed values keyTokens cuts at ":" (Bedrock anthropic.claude-...-v1:0, OpenAI ft:...).
  keyTokens now runs on the line with the value blanked. Exact-equality perturbation turns both tests red.
- W: MODEL_PASSPHRASE, REGION_BEARER counted as public, and the plan's premise that shape rules catch such a key was
  measured false. isPublicName now requires the LAST part public (or <public>_ID/_NAME); more secret words added;
  premise rewritten.
- W: camelCase JSON names (defaultModel, modelId) were never public. Now split on camelCase.
- N: ZONE dropped (CF_ZONE_ID stays held, with a control); assignedValue comment reworded; isPublicName table widened
  (model.api-key, model-secret, modelToken, SESSION_ID, ID).
- Note: the background validation run overlapped these edits; it is discarded and rerun.
### Iteration 2 (sonnet): 1 WARNING, fixed.
- W: the value was blanked with a non-global replace, so a comment restating it on the same line held it again.
  Now every occurrence is blanked (split/join); a CHAT_MODEL line with the value restated in its comment is in the
  collector test and goes red under the single replace.
- The second background validation (val4111b) was also stopped for this edit; validation runs once, at 6j.
### Iteration 3 (opus): 3 WARNINGs (one caused by my round-2 fix), 3 NITs, all fixed.
- W (from round 2): blanking every occurrence of a SHORT value (API_VERSION=2, TZ=UTC) cut a real key in the
  comment into pieces. Nothing is blanked now: the line is cut as always and only the public value's own pieces
  (the value and keyTokens of it) are dropped. Perturbation back to blanking: the API_VERSION key goes red.
- W: the env parser takes the value up to a space, so REGION=us-east-1;TOKEN=<key> hid the key inside the "value".
  The public value now stops at the first ; or ,. Perturbation without the cut: that key goes red.
- W: secret words glued into a part (PRIVKEY_VERSION, APITOKEN_MODEL) passed as public. Secret words now match
  inside each part (over-matching only keeps a value held). Anchored perturbation: two tests red.
- N: comment reflowed; one-line check uses [\r\n]; isPublicName table pins the glued cases.
### Iteration 4 (sonnet): 1 WARNING fixed, 1 NIT documented, 1 CONVENTION deferred.
- W: plurals were public only for MODELS; REGIONS, VERSIONS, LOCALES, LANGS, LANGUAGES, TIMEZONES added and tested.
- N: a glued one-word name (APIVERSION, MODELNAME) is not split and stays held; stated in the comment, pinned in the
  table as not public (the safe direction).
- C (deferred, repo practice): plan filename without a timestamp; this directory holds both forms.
### Iteration 5 (opus): 2 WARNINGs, 3 NITs, all fixed.
- W: a key glued into a public value with : or = (MODEL=gpt-4o:<key>, REGION=us-east-1&token=<key>) was dropped as
  one of the value's own pieces, a regression against main. A piece is now dropped only when configShaped (one case,
  cut by - or ., not only hex); a key assigned to a public NAME outright (LOCALE=<key>) and a UUID are also held.
  Perturbation (drop every own piece): the glued key goes red.
- W: YAML with a trailing comment or as a list item did not parse, so the model id was held. Those shapes are read
  for the NAME only; non-public lines are held exactly as before. Perturbation (no YAML path): red.
- N: header comment states the #4111 exception; assignedValue comment rewrapped; acronym-led camelCase documented.
