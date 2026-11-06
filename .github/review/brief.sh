#!/usr/bin/env bash
# Writes the brief of pull request $PR to stdout: the issues it closes, then its title and description.
set -euo pipefail

for issue in $(bash .github/review/issues.sh); do
	gh issue view "$issue" --json number,title,body --jq '"# Issue #\(.number): \(.title)\n\n\(.body)\n"'
done
gh pr view "$PR" --json number,title,body --jq '"# Pull request #\(.number): \(.title)\n\n\(.body)\n"'
base=$(gh pr view "$PR" --json baseRefName --jq .baseRefName)
echo "Review this pull request. It goes into \`$base\`: its change is \`git diff origin/$base...HEAD\`, its commits \`git log origin/$base..HEAD\`."
