---
description: Stage, commit, and push changes safely. Always runs a secrets scan first and aborts if any credentials are found. Use when the user confirms they want to commit and push.
---

Follow this sequence exactly — do not skip or reorder steps.

## Step 1 — Secrets scan
Apply the AdamJ:secrets-check skill to all modified files.

If any secrets or credentials are found: stop immediately. Do not stage, commit, or push. Report findings and ask the user to resolve them before retrying.

## Step 2 — Stage
If the scan is clean, stage the relevant files. Prefer specific file paths over `git add .` unless the user explicitly asks to stage everything.

## Step 3 — Commit message
If the user has not provided a commit message, ask for one. The message should describe the *why*, not the what. Subject line under 72 characters.

Commit with co-author attribution:
```
git commit -m "$(cat <<'EOF'
<message>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Step 4 — Push
Run `git push origin <current-branch>`. If the branch has no upstream, use `git push -u origin <current-branch>`.

## Step 5 — Confirm
Report the commit hash, branch name, and that the push succeeded.
