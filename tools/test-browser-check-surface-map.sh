#!/usr/bin/env bash
# #2518: the surface MAP must stay honest. Every `// Browser-check-surface:` token a
# browser-check declares must have at least one FUNCTIONAL occurrence in web/index.html
# (an HTML id=, a CSS selector, a getElementById/closest/string-literal id). The hard bar is
# FUNCTIONAL PRESENCE; a comment occurrence ALONGSIDE a functional one is tolerated (see the
# per-token gate below). Two failure modes matter:
#   - DEAD (HARD FAIL): 0 functional occurrences -> the gate can never legitimately fire, so a
#     stale check it was meant to guard slips through silently. This is what the guard exists
#     to catch, so the classifier must never mistake a comment-only token for functional.
#   - OVER-FIRE (TOLERATED): the token ALSO appears inside a comment -> a prose-wording edit to
#     that comment could fire the gate, resolved by the per-check override. Reported, not failed
#     (the merged seeds carry such tokens; requiring comment-free would reject most tokens,
#     since this codebase documents ids in comments widely).
# The kosmos#2518 batch-2 review found fr-return whose only occurrence sat on a multi-line
# <!-- --> CONTINUATION line, and the iteration-2 review found the mirror hole: a comment
# OPENING after real code on the same line (`<markup> <!-- token -->`). A "does the line start
# with a marker" heuristic missed both, so the classifier is POSITION-ACCURATE.
#
# HOW: split_halves walks a file ONCE, splitting every line into a CODE half (comment spans
# blanked to spaces) and a COMMENT half (code spans blanked), preserving character positions so
# the whole-token boundary match still sees the token's real neighbours. A token is FUNCTIONAL if
# it lands in the code half, COMMENT if in the comment half. Doing the walk once per FILE (not
# once per token) keeps the whole guard fast on an 80k-line web/index.html.
#
# Handles the two block-comment forms exactly (<!-- -->, /* */; they do not nest, one form inside
# the other is just comment text) and line // comments, treated as a comment to end-of-line UNLESS
# the // is the :// of a URL scheme (guarded on a preceding : only). KNOWN RESIDUAL, accepted for a
# dev-time honesty guard: there is no string tokenizer. A stray OPENER (/* or // inside a real code
# string, `var s="a/*b"`) can falsely open a comment and blank later real code -- a false FAIL (a
# live token read as dead), the SAFE direction. A CLOSER (--> or */) is NOT a string-literal hazard:
# HTML and JS comments contain no string literals, so --> ends an HTML comment and */ ends a block
# comment at their FIRST occurrence regardless of surrounding quotes -- exactly what the browser and
# the gate do. So the classifier tracks the real parser there, not the author's intent, and a token
# after such a closer is genuinely code (correctly functional), not a false pass. The one true
# residual is therefore the opener/false-FAIL case above; not tripped by any current token; the fix
# (full JS/HTML tokenization) is out of proportion here; the per-check override is the escape hatch.
#
# dstat/dpath naming avoided; no tied var names (path/status/cdpath); find, not a glob (zsh aborts
# a no-match glob); every glob quoted. Runs under bash (shebang), wired into test:shell. Most surface
# tokens are DOM ids ([A-Za-z0-9_-]+), some are not (data-pmark="xai"), and the annotation parser
# accepts any string, so token_web_scan escapes ERE metachars, as the sibling gate does.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$REPO/web/index.html"
BCDIR="$REPO/docs/browser-checks"
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
[ -f "$WEB" ] || { echo "FAIL  no web/index.html at $WEB"; exit 1; }
[ -d "$BCDIR" ] || { echo "FAIL  no $BCDIR"; exit 1; }

# Every temp file goes in ONE directory the trap removes (#5907): _mktmp runs inside $(...), so a list it appended to
# lived in a subshell and the old cleanup removed nothing (19 files, 13 MB left per run, measured).
_TMPD="$(mktemp -d "${TMPDIR:-/tmp}/bcsm.XXXXXX")" || { echo "FAIL  could not make a temp directory"; exit 1; }
_mktmp() { mktemp "$_TMPD/t.XXXXXX"; }
cleanup() { rm -rf "$_TMPD"; }
trap cleanup EXIT

# split_halves <infile> <codeout> <cmtout>: one pass, position-accurate (see header).
split_halves() {
  awk -v CODE="$2" -v CMT="$3" '
    { line=$0; code=""; cmt=""; n=length(line); i=1
      while (i <= n) {
        if (inhtml) {
          if (substr(line,i,3)=="-->") { code=code"   "; cmt=cmt"-->"; inhtml=0; i+=3; continue }
          code=code" "; cmt=cmt substr(line,i,1); i++; continue
        }
        if (inblock) {
          if (substr(line,i,2)=="*/") { code=code"  "; cmt=cmt"*/"; inblock=0; i+=2; continue }
          code=code" "; cmt=cmt substr(line,i,1); i++; continue
        }
        if (substr(line,i,4)=="<!--") { code=code"    "; cmt=cmt"<!--"; inhtml=1; i+=4; continue }
        if (substr(line,i,2)=="/*")   { code=code"  ";  cmt=cmt"/*";  inblock=1; i+=2; continue }
        if (substr(line,i,2)=="//") {
          # A // begins a line comment UNLESS it is the :// of a URL scheme. Guard on a preceding
          # colon ONLY (a colon right before // is essentially always a scheme like https:// or
          # wss://). A preceding quote is deliberately NOT exempted: a string END followed by a
          # comment reads as a comment, which is correct; exempting the quote would keep the
          # comment in the code half and false-pass a comment-only token (the dangerous
          # direction). No protocol-relative quote-slash-slash URL exists in web/index.html for a
          # quote exemption to protect, and one would cost only a false FAIL (the safe direction).
          prevc=(i>1)?substr(line,i-1,1):""
          if (prevc!=":") {
            rest=substr(line,i); pad=rest; gsub(/./," ",pad); code=code pad; cmt=cmt rest; break
          }
        }
        code=code substr(line,i,1); cmt=cmt" "; i++
      }
      print code > CODE
      print cmt  > CMT
    }
    END { close(CODE); close(CMT) }' "$1"
}

# token_web_scan <token> <code-half> <cmt-half> -> "<functional_lines> <comment_lines>".
# grep -c counts LINES containing a whole-token match (a line where the token appears in BOTH
# halves counts toward both, which is correct). grep exits 1 on zero matches; with no `set -e`
# the count is still captured. The token is ERE-escaped with the SAME sed the sibling gate uses
# (browser-check-surface-gate.sh), so a token carrying a metachar (`.`, `+`, ...) matches only
# itself, not a lookalike -- parity with the gate, and never a false pass. (Most surface tokens
# are DOM ids, but the annotation parser accepts any string, so this must not assume.)
token_web_scan() {
  local esc; esc="$(printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
  local b="(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)"
  printf '%s %s' "$(grep -cE "$b" "$2")" "$(grep -cE "$b" "$3")"
}

# #5907: one pass per half counts every PLAIN token (only [A-Za-z0-9_-], the boundary class) at once. A line splits into
# maximal runs of that class, and a plain token sits between boundaries exactly when it is one of those runs, so this is
# token_web_scan's match; a line counts once per token, as grep -c counts lines. Prints "token count" for each wanted
# token. (The split is C-locale and the grep runs in the ambient locale: on invalid UTF-8 next to a token, or in a
# locale whose A-Z range takes accented letters, they can differ. web/index.html is valid UTF-8, and macOS ranges are
# ASCII.) Calling token_web_scan per token cost two full-file greps for each of ~1,000 tokens (most of this test's time).
count_plain_tokens() {   # $1: file of tokens, one per line; $2: the half to count in
  # FILENAME == ARGV[1], not NR == FNR: an empty token file must not turn the half's own lines into wanted tokens.
  LC_ALL=C awk 'FILENAME == ARGV[1] { if ($0 != "") want[$0]=1; next }
       { split("", seen); n=split($0, w, /[^A-Za-z0-9_-]+/)
         for (k=1; k<=n; k++) if (w[k] != "" && (w[k] in want) && !(w[k] in seen)) { seen[w[k]]=1; c[w[k]]++ } }
       END { for (t in want) print t, ((t in c) ? c[t] : 0) }' "$1" "$2"
}

# The table "token functional comment" for every PLAIN token in $1 (ASCII only, LC_ALL=C), counted in halves $2 and $3.
count_table() {   # $1: tokens, one per line; $2, $3: the code and comment halves
  local plain fn cm; plain="$(_mktmp)"; fn="$(_mktmp)"; cm="$(_mktmp)"
  LC_ALL=C grep -E '^[A-Za-z0-9_-]+$' "$1" | LC_ALL=C sort -u > "$plain"
  [ -s "$plain" ] || return 0
  count_plain_tokens "$plain" "$2" > "$fn"
  count_plain_tokens "$plain" "$3" > "$cm"
  awk 'FILENAME == ARGV[1] { f[$1]=$2; next } { print $1, f[$1], $2 }' "$fn" "$cm"
}

# token_web_scan's "functional comment" pair for token $1: from table $2 when the token is in it (compared as strings,
# so a numeric-looking token never matches another's row), else token_web_scan over halves $3 and $4. A token the table
# lacks, for whatever reason, costs the grep's time, never a different answer.
token_counts() {
  # The token through the environment, not -v: -v interprets backslash escapes, so \101 would read as A. A row missing a
  # count (a failed pass) falls back too.
  local got; got="$(T="$1" awk '($1 "") == (ENVIRON["T"] "") { if ($2 != "" && $3 != "") printf "%s %s", $2, $3; exit }' "$2")"
  if [ -n "$got" ]; then printf '%s' "$got"; else token_web_scan "$1" "$3" "$4"; fi
}

WEB_CODE="$(_mktmp)"; WEB_CMT="$(_mktmp)"
split_halves "$WEB" "$WEB_CODE" "$WEB_CMT"

# Each check's annotation, parsed once ("path<TAB>tokens", in find's order), so the table and the loop below read the same
# tokens. A path is read up to its first tab, so a check file with a tab in its name would not parse (none has one).
ANNOT="$(_mktmp)"; ALL_TOKS="$(_mktmp)"; COUNTS="$(_mktmp)"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  toks="$(sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$f" | head -1)"
  printf '%s\t%s\n' "$f" "$toks"
done <<< "$(find "$BCDIR" -maxdepth 1 -type f -name '*.js' 2>/dev/null)" > "$ANNOT"
cut -f2- "$ANNOT" | tr ' \t' '\n\n' > "$ALL_TOKS"
count_table "$ALL_TOKS" "$WEB_CODE" "$WEB_CMT" > "$COUNTS"
# The fast path is really taken: one table row per distinct plain declared token. If the parse above broke, every token
# would fall back to the grep, still right but slow again (#5907), and nothing else would say so.
_nplain="$(LC_ALL=C grep -E '^[A-Za-z0-9_-]+$' "$ALL_TOKS" | LC_ALL=C sort -u | wc -l | tr -d ' ')"
_nrows="$(awk 'NF == 3' "$COUNTS" | wc -l | tr -d ' ')"   # complete rows only: a row missing a count is not counted
if [ "$_nrows" = "$_nplain" ]; then ok "the counted table holds all $_nrows plain tokens (the fast path is taken)"
else bad "the counted table holds $_nrows rows for $_nplain plain tokens: the fast path is not taken"; fi
# And the table's VALUES on the real page, not only its rows: every 40th plain token against token_web_scan, so a counter
# that undercounts (and stays above zero, so the loop would still pass) goes red here.
_spot=0; _spotbad=0
while IFS= read -r t; do
  [ -n "$t" ] || continue   # a here-string of no tokens still delivers one empty line
  _spot=$((_spot + 1))
  _got="$(token_counts "$t" "$COUNTS" /dev/null /dev/null)"; _want="$(token_web_scan "$t" "$WEB_CODE" "$WEB_CMT")"
  [ "$_got" = "$_want" ] || { bad "SPOT: the table says '$_got' for $t on web/index.html, token_web_scan says '$_want'"; _spotbad=1; }
done <<< "$(LC_ALL=C grep -E '^[A-Za-z0-9_-]+$' "$ALL_TOKS" | LC_ALL=C sort -u | awk 'NR % 40 == 1')"
if [ "$_spot" -eq 0 ]; then ok "SPOT: no plain token declared, so nothing to sample"
elif [ "$_spotbad" -eq 0 ]; then ok "SPOT: the table matches token_web_scan on all $_spot sampled real tokens"; fi

annotated=0
while IFS="$(printf '\t')" read -r f toks; do
  [ -n "$f" ] || continue
  [ -n "$toks" ] || continue
  annotated=$((annotated + 1))
  base="${f##*/}"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    scan="$(token_counts "$t" "$COUNTS" "$WEB_CODE" "$WEB_CMT")"; fn="${scan%% *}"; cmt="${scan##* }"
    if [ "$fn" -ge 1 ]; then
      # A comment occurrence alongside the functional one is a minor OVER-FIRE risk (a
      # wording edit to that comment fires the gate; the per-check override clears it). It
      # is TOLERATED, not failed: the merged seeds carry such tokens and this codebase
      # documents ids in comments widely, so requiring comment-free would reject most tokens
      # and break the baseline. The gate still does real work whenever the id itself changes.
      ok "$base: '$t' -- $fn functional line(s)$( [ "$cmt" -gt 0 ] && printf ' (+%s comment line(s), tolerated over-fire)' "$cmt")"
    else
      bad "$base: '$t' has NO functional occurrence in web/index.html ($cmt comment/absent) -- a DEAD annotation the gate can never legitimately fire on; it fires only on a comment-wording edit. Choose a token with a real id=/selector/getElementById occurrence."
    fi
  done <<< "$(printf '%s' "$toks" | tr ' \t' '\n\n')"
done < "$ANNOT"

# The map must not be silently empty (a broken parse would pass vacuously otherwise).
[ "$annotated" -ge 1 ] \
  && ok "found $annotated annotated check(s) to validate (map is non-empty)" \
  || bad "no annotated checks found -- the parse is broken or the map is empty (vacuous pass averted)"

# RED-CAPABILITY, on a synthetic fixture (not web/index.html, so it does not drift). Each arm
# is a shape the guard must classify correctly or it cannot be trusted; a broken classifier
# flips at least one, so an all-green run means the classifier is sound across these shapes.
_fx="$(_mktmp)"
printf '%s\n' \
  '<div id="tok-func">x</div>' \
  '<!-- a multi-line comment' \
  'that mentions #tok-cont on this continuation line' \
  '-->' \
  '<div id="other">x</div> <!-- tok-trail mentioned here -->' \
  '<button id="tok-split">go</button> <!-- see #tok-note below' \
  'still in the comment -->' \
  'foo(); /* tok-block old id */ bar();' \
  '<a href="https://tok-url.example/x">link</a>' \
  'var s = "a"//tok-strcmt is a real line comment right after a string quote' \
  '<div id="tokXdot">x</div>' \
  '<span>nothing</span>' > "$_fx"
_fxc="$(_mktmp)"; _fxm="$(_mktmp)"; split_halves "$_fx" "$_fxc" "$_fxm"
_chk() { got="$(token_web_scan "$1" "$_fxc" "$_fxm")"; [ "$got" = "$2" ] && ok "CONTROL ($4): $3 (got '$got')" || bad "CONTROL ($4): $3 -- got '$got', want '$2'"; }
_chk tok-func  "1 0" "a real id= occurrence is functional"                              "functional"
_chk tok-cont  "0 1" "a token on a multi-line <!-- --> continuation line is comment"     "continuation"
_chk tok-trail "0 1" "a token in a comment OPENING after code on the same line is comment" "trailing-same-line"
_chk tok-split "1 0" "a real id= before a trailing comment on the same line stays functional" "split-line-code"
_chk tok-note  "0 1" "a token in a same-line-opened comment that closes on a later line is comment" "split-line-comment"
_chk tok-block "0 1" "a token inside a mid-line /* */ block is comment"                   "block-comment"
_chk tok-url   "1 0" "a token in a // that is really a URL (https://) stays functional"    "url-not-comment"
_chk tok-strcmt "0 1" "a // line comment right after a string quote is comment, not a URL" "quote-then-linecomment"
_chk 'tok.dot' "0 0" "a token with an ERE metachar is escaped, so tok.dot does NOT match tokXdot" "metachar-escaped"
_chk tok-absent "0 0" "an absent token is neither functional nor comment"                  "absent"
# #5907: the counted path (count_table + token_counts, as the loop above uses it) agrees with token_web_scan on its own
# fixture: a token twice on one line (a line counts once) and again on another line (lines add up), a token inside a
# longer run (not a match: tok inside tok-dup and tok_u, TOK and UP inside TOK-UP, so `_`, `-` and capitals are all
# run characters), one in a comment, a numeric-looking pair (1e3 present, 1000 absent: compared as strings), and an
# absent one. Names any token that drifts.
_pf="$(_mktmp)"
printf '%s\n' \
  '<div id="tok-dup">a</div> <span class="tok-dup">b</span>' \
  '<div id="tok-dup-long">c</div>' \
  '<!-- tok-dup in a comment -->' \
  '<i id="1e3"></i>' \
  '<p class="tok-dup">e</p>' \
  '<b id="tok_u">f</b> <b id="TOK-UP">g</b>' > "$_pf"
_pfc="$(_mktmp)"; _pfm="$(_mktmp)"; split_halves "$_pf" "$_pfc" "$_pfm"
_ptoks="$(_mktmp)"; printf '%s\n' tok-dup tok-dup-long tok 1e3 1000 tok-absent tok_u TOK-UP TOK UP > "$_ptoks"
# And a backslash token that is not plain, so it is not in the table: it must take the grep, never A's row.
_pesc='\101'
_ptab="$(_mktmp)"; count_table "$_ptoks" "$_pfc" "$_pfm" > "$_ptab"
_pbad=0
while IFS= read -r t; do
  want="$(token_web_scan "$t" "$_pfc" "$_pfm")"
  got="$(token_counts "$t" "$_ptab" /dev/null /dev/null)"
  [ "$got" = "$want" ] || { bad "PARITY: the counted path says '$got' for $t, token_web_scan says '$want'"; _pbad=1; }
done < "$_ptoks"
[ "$(awk 'NF == 3' "$_ptab" | wc -l | tr -d ' ')" = "$(wc -l < "$_ptoks" | tr -d ' ')" ] || { bad "PARITY: the table did not count every plain token"; _pbad=1; }
printf 'A 7 7\n' >> "$_ptab"
[ "$(token_counts "$_pesc" "$_ptab" "$_pfc" "$_pfm")" = "$(token_web_scan "$_pesc" "$_pfc" "$_pfm")" ] \
  || { bad "PARITY: a backslash token took another token's row"; _pbad=1; }
[ "$_pbad" -eq 0 ] && ok "PARITY: the counted path matches token_web_scan on all $(wc -l < "$_ptoks" | tr -d ' ') parity tokens"

[ "$FAILS" -eq 0 ] && echo "browser-check surface map: all arms passed" || echo "browser-check surface map: $FAILS FAILED"
exit "$FAILS"
