#!/bin/sh
# The Windows agent's `kosmos` command, for Git Bash. Shipped as <zip>/bin/kosmos
# (no extension, so Git Bash resolves a bare `kosmos` to it) by
# tools/build-kosmos-windows.sh.
# The zip's own node runs the CLI. Its two paths are converted here with cygpath
# (always present in Git Bash), and MSYS path conversion is then turned OFF for
# the arguments, or a message mentioning /c/something would reach the board
# rewritten as C:\something. Measured: every character of an agent's message
# arrives intact this way, newlines, quotes, & and % included.
command -v cygpath >/dev/null 2>&1 || { echo "kosmos: this shim runs in Git Bash, which provides cygpath; it is not on PATH here" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
node=$(cygpath -w "$here/../runtime/node.exe")
cli=$(cygpath -w "$here/kosmos-cli.js")
# #5946: the one argument that IS a path, --body-file's, is converted here, since
# conversion is off for the rest: a Git Bash path such as /tmp/post.txt (mktemp's)
# would otherwise reach Windows node as C:\tmp\post.txt, which does not exist.
# Only a value starting with / is converted, nothing after a bare --, which
# ends the options and starts the agent's own words, and only for the verbs
# that take a path flag: --body-file for feedback and community, and (#6726)
# --file for reply. Any other verb's words go as typed.
# If cygpath cannot convert it, the path goes as typed, so the CLI's refusal names it.
convert_next=
past_options=
flag=
case ${1-} in community|feedback) flag=--body-file ;; reply) flag=--file ;; *) past_options=1 ;; esac
for arg do
  shift
  if [ -n "$convert_next" ]; then
    convert_next=
    case $arg in
      /*) conv=$(cygpath -w -- "$arg" 2>/dev/null) && [ -n "$conv" ] && arg=$conv ;;
      --) past_options=1 ;;   # no value given; the CLI refuses it, and nothing after it is converted
    esac
  elif [ -z "$past_options" ]; then
    case $arg in
      --) past_options=1 ;;
      "$flag") convert_next=1 ;;
      "$flag"=/*) conv=$(cygpath -w -- "${arg#"$flag"=}" 2>/dev/null) && [ -n "$conv" ] && arg="$flag=$conv" ;;
    esac
  fi
  set -- "$@" "$arg"
done
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec "$node" "$cli" "$@"
