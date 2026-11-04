#!/usr/bin/env bash
# Writes the brief of pull request $PR to stdout: the issues it closes, then its title and description.
set -euo pipefail

for issue in $(gh pr view "$PR" --json closingIssuesReferences --jq '.closingIssuesReferences[].number'); do
	gh issue view "$issue" --json number,title,body --jq '"# Issue #\(.number): \(.title)\n\n\(.body)\n"'
done
gh pr view "$PR" --json number,title,body --jq '"# Pull request #\(.number): \(.title)\n\n\(.body)\n"'
echo "Review this pull request. Its change is \`git diff origin/main...HEAD\`."
