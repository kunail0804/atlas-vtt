#!/usr/bin/env bash
# Decides which reviewers run on a pull request, and writes `reviewers` (a JSON list) to $GITHUB_OUTPUT.
#
# - Pull request opened or ready for review: the reviewers asked for by the issues it closes, as labels
#   `review:<name>` or as ticked boxes of the Tâche template.
# - Comment `/review [claude|glm|deepseek|all ...]`: the reviewers named, or those of the issues if none.
#
# Env: PR, EVENT (pull_request|issue_comment), COMMENT.
set -euo pipefail

known='claude glm deepseek'

from_issues() {
	local issue
	for issue in $(bash .github/review/issues.sh); do
		gh issue view "$issue" --json labels --jq '.labels[].name | select(startswith("review:")) | ltrimstr("review:")'
		gh issue view "$issue" --json body --jq .body | sed -nE 's/^- \[[xX]\] (Claude|GLM|DeepSeek)[[:space:]]*$/\1/p'
	done
}

# The reviewers run the pull request's code with the model keys in their environment. A comment `/review`
# runs with the secrets whatever the pull request's origin, so a fork's pull request never gets one.
if [[ "$(gh pr view "$PR" --json isCrossRepository --jq .isCrossRepository)" == true ]]; then
	echo "::warning::Pull request #$PR comes from a fork: no review, its code would run with the keys."
	echo 'reviewers=[]' >>"$GITHUB_OUTPUT"
	exit 0
fi

case "$EVENT" in
pull_request)
	asked="$(from_issues)"
	;;
issue_comment)
	asked="$(head -n1 <<<"$COMMENT" | sed -E 's|^/review[[:space:]]*||')"
	if [[ -z "${asked//[[:space:]]/}" ]]; then
		asked="$(from_issues)"
	elif grep -qiw all <<<"$asked"; then
		asked="$known"
	fi
	;;
*)
	echo "::error::Unexpected event $EVENT"
	exit 1
	;;
esac

reviewers="$(
	tr '[:upper:]' '[:lower:]' <<<"$asked" | tr -s '[:space:],' '\n' | { grep -xE "${known// /|}" || true; } |
		sort -u | jq -Rnc '[inputs]'
)"
echo "Pull request #$PR, reviewers: $reviewers"
echo "reviewers=$reviewers" >>"$GITHUB_OUTPUT"
