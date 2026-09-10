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
# once per token) keeps the whole guard fast on a 40k-line web/index.html.
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
# a no-match glob); every glob quoted. Runs under bash (shebang), wired into test:shell. Surface
# tokens are DOM ids ([A-Za-z0-9_-]+, no ERE metachars), so the grep boundary needs no escaping;
# the sibling gate escapes because it cannot assume that.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$REPO/web/index.html"
BCDIR="$REPO/docs/browser-checks"
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
[ -f "$WEB" ] || { echo "FAIL  no web/index.html at $WEB"; exit 1; }
[ -d "$BCDIR" ] || { echo "FAIL  no $BCDIR"; exit 1; }

_TMPS=()
_mktmp() { local t; t="$(mktemp "${TMPDIR:-/tmp}/bcsm.XXXXXX")"; _TMPS+=("$t"); printf '%s' "$t"; }
cleanup() { [ "${#_TMPS[@]}" -gt 0 ] && rm -f "${_TMPS[@]}"; }
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
# itself, not a lookalike -- parity with the gate, and never a false pass. (Surface tokens are
# DOM ids in practice, but the annotation parser accepts any string, so this must not assume.)
token_web_scan() {
  local esc; esc="$(printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
  local b="(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)"
  printf '%s %s' "$(grep -cE "$b" "$2")" "$(grep -cE "$b" "$3")"
}

WEB_CODE="$(_mktmp)"; WEB_CMT="$(_mktmp)"
split_halves "$WEB" "$WEB_CODE" "$WEB_CMT"

annotated=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  toks="$(sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$f" | head -1)"
  [ -n "$toks" ] || continue
  annotated=$((annotated + 1))
  base="${f##*/}"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    scan="$(token_web_scan "$t" "$WEB_CODE" "$WEB_CMT")"; fn="${scan%% *}"; cmt="${scan##* }"
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
done <<< "$(find "$BCDIR" -maxdepth 1 -type f -name '*.js' 2>/dev/null)"

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

[ "$FAILS" -eq 0 ] && echo "browser-check surface map: all arms passed" || echo "browser-check surface map: $FAILS FAILED"
exit "$FAILS"
