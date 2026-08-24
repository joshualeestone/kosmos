# styles-tab: #480, themes and a paste-in style, tokens only

## What finished looks like (Josh 19:15; function and plain words, polish
## deferred by his 19:40 ruling)

A Settings tab "Styles" between Plus Account and Advanced. Two ways in:
a few named themes (complete token sets built from the page's own
palette; Kosmos is the shipped look), applying the moment one is picked,
and a paste-in box for a style file a person's agent wrote.

TOKENS ONLY, NEVER A STYLESHEET: a pasted style is lines of
--name: value; and nothing else. No selectors, no braces, no url(), no
markup, so a paste can recolor the page and cannot make it fetch, hide
or impersonate anything. Every refusal is a sentence naming the line.
The custom set layers over the theme (the person's own last word wins),
applies via setProperty on the root so it shows in light and dark alike
(said in the tab's words), survives reload (applied at boot), and has a
one-click removal that keeps the theme (no dead ends).

engine/styles.js holds the store (styles.json, unique-tmp wx writes, a
corrupt file falls back to the shipped look and says so), the parser and
the themes; two thin routes; the tab paints on arrival.

## Tests

engine/styles.test.js: the parser's refusal directions each named by
line, the layering, the clear-keeps-theme path, the corrupt fallback.
server.test.js: the round-trip, the refusal, and that a refused paste
does not destroy the standing style. Nav pins and the settings browser
check updated for the tenth section; a headed drive applied a theme and
a paste with zero page errors.

## Review bound

Two rounds maximum, stopping rule standing.
