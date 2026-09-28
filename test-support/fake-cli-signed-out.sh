#!/bin/sh
# #4326: the test stand-in for gh / vercel / cloudflared. It answers at once, as a CLI that is
# installed but signed out: a non-zero exit and one line, so a status probe reads "not
# connected" and never waits on a prompt. tools/run-tests.sh exports it as the default
# AGENT_WORKFORCE_GH_BIN / AGENT_WORKFORCE_VERCEL_BIN; a test that needs a signed-in answer
# sets its own.
echo "not logged in (kosmos test fake)" >&2
exit 1
