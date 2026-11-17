#!/bin/sh
# Offline protocol tests against emulated devices: sh tests/run.sh
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in tests/*.test.mjs; do
  out=$(node "$t" "$PWD/web" 2>&1); code=$?
  echo "$t: $(echo "$out" | grep -c '^ok') ok"
  if [ $code -ne 0 ] || echo "$out" | grep -q '^FAIL'; then echo "$out" | grep -v '^ok'; fail=1; fi
done
exit $fail
