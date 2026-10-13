#!/bin/sh
# no-mistakes lint gate: fail on a secret in the commits this branch adds over the default branch.
# A missing gitleaks fails; it is never skipped. Allowlist: .gitleaksignore (fingerprints only).
set -eu
command -v gitleaks >/dev/null 2>&1 || { echo "gitleaks not found on PATH (need 8.30.1)" >&2; exit 1; }
base=
for ref in origin/main main; do
  base=$(git merge-base "$ref" HEAD 2>/dev/null) && break || base=
done
# ponytail: no default-branch ref in this checkout -> scan all reachable history (slower, never weaker)
range=${base:+$base..}HEAD
exec gitleaks git --no-banner --redact --exit-code 1 --log-opts="$range" .
