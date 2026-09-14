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
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec "$node" "$cli" "$@"
