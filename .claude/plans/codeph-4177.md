# #4177: the Claude code field no longer says the code comes by email

## Finished looks like
Settings, Add a provider, Claude sign-in: the code field's placeholder and aria-label say "Sign-in code" (the name the
first-run field already uses), not "The code from your email". web.connect-tail-977 pins it and fails on main.

## Decided
- "Sign-in code", copied from the first-run field (fr-conn-code), so the two sign-ins name the field alike; no new wording.
- Weakest premise: a placeholder that only names the field says less than one that hints where the code comes from;
  the line above already says it (If Claude gives you a code...).
