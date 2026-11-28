#!/bin/sh
# Refuse to start when more than one API answers as "api" on the shared network (#119).
#
# nginx finds the API by the name "api" (proxy_pass http://api:8000 in nginx.conf). It looks
# the name up once, when it starts, and sends requests to every address it got in turn. So
# with two backend stacks on the shared network (say the usual one and a second with its
# own database, for testing), half the requests reach the wrong one: a setup or reset link
# made through one API is "not valid" for the other, and a signed-in person is sometimes
# treated as signed out. This is what made links return 400 in the review of #92.
#
# The official nginx image runs every executable script in /docker-entrypoint.d/ before
# nginx starts, and stops the container if one fails (the Dockerfile copies this one
# there). No answer, or one, lets nginx start as before; two or more stop it here, with a
# message that names them. The backend refuses a second API from its side too (backend
# #213); this catches one that was already running when nginx starts.

set -eu

# Every IPv4 address Docker's DNS gives for the name, once each (empty if none yet).
addresses=$(getent ahostsv4 api | awk '{ print $1 }' | sort -u)
count=$(printf '%s\n' "$addresses" | grep -c . || true)

if [ "$count" -le 1 ]; then
  exit 0
fi

# Name each one as Docker's DNS does ("<container>.<network>"), or just the address.
echo "More than one API answers as 'api' on this Docker network:" >&2
for address in $addresses; do
  name=$(nslookup "$address" 2>/dev/null | awk -F'name = ' '/name = / { print $2; exit }')
  echo "  ${name:-unknown container} ($address)" >&2
done
echo "nginx would send requests to each in turn, so links, sign-ins, and changes would fail" >&2
echo "at random. Stop the extra backend stack (see 'docker ps'), then start this one again." >&2
exit 1
