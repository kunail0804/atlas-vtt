#!/usr/bin/env bash
# Prints the issues pull request $PR closes, one number a line. GitHub links `Closes #<n>` only for a pull
# request into the default branch (main), so the description is read too: pull requests go into develop.
set -euo pipefail

{
	gh pr view "$PR" --json closingIssuesReferences --jq '.closingIssuesReferences[].number'
	gh pr view "$PR" --json body --jq .body | grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?) +#[0-9]+' | grep -oE '[0-9]+$' || true
} | sort -un
