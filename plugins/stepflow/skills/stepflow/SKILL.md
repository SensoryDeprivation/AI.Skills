---
description: Turn multi-step instructions into a local "stepflow" page — one step at a time with Done/Blocked/Skip, a per-step Claude spin-off for troubleshooting, and a runbook export of lessons learned. Use when the user runs /stepflow, asks for a stepflow, or hands back a stepflow runbook to repeat a procedure.
---

A stepflow keeps a procedure and its troubleshooting apart. The user works through the steps on a localhost page; when a step fails they troubleshoot it in that step's spin-off chat (a `claude -p` session that knows the whole procedure), not in this conversation. So **do not repeat the steps in chat** — the page is the copy the user works from.

Scripts live in this skill's `scripts/` directory (`server.mjs`, `flow.mjs`, `claude.mjs`, `page.html`). Requires Node 18+ and `claude` on PATH.

## Pick the mode from the argument

1. **`/stepflow <slug or folder>` naming an existing flow** (a folder under `~/.stepflow/` exists): just restart its server (see *Start the server*). Don't read or summarize the flow.
2. **`/stepflow <path to runbook.md>`**: read the runbook and write a new flow for the same goal with the lessons **folded into the steps**: fix the commands that needed fixing, add the prerequisite steps that were discovered, reword UI steps to match what the user actually saw, drop steps that were skipped as unnecessary. Lessons must not survive as side notes — the new steps should simply work. Then create the flow (below).
3. **`/stepflow` or `/stepflow <task>`**: use the multi-step instructions already in this conversation, or work out the steps for `<task>`. First look in the runbook library, `~/.claude/stepflow/runbooks/` (`$CLAUDE_CONFIG_DIR/stepflow/runbooks/` if that is set; one `<flow folder name>.md` per flow): if a runbook there covers the same procedure, treat it as mode 2 and fold its lessons in. Then create the flow.

The library is also worth reading, outside `/stepflow`, whenever the user is about to repeat a procedure that one of its runbooks covers.

## Create the flow

Write `~/.stepflow/<yyyy-mm-dd>-<short-slug>/flow.json` (on Windows `~` is `$env:USERPROFILE`):

```json
{
  "title": "Install and configure X",
  "goal": "One sentence: what is true when all steps are done",
  "context": "OS, shell, versions, constraints the spin-off should know",
  "cwd": "C:\\path\\the\\spin-off\\should\\run\\in",
  "steps": [
    {
      "title": "Short imperative title",
      "body": "Markdown. Commands in fenced blocks with a language tag.",
      "expected": "Markdown. What the user should see if the step worked (output, file, UI state)."
    }
  ]
}
```

- One action per step, so Done/Blocked is meaningful.
- Always fill `expected` with what success looks like: the output to expect (in a fenced block if it's literal output), the file that should exist, or the UI state. The page shows it right under the command; keep it out of `body`.
- Every command goes in a fenced block (the page adds a Copy button). Click-through steps name the exact menu path.
- `cwd`: the project directory if the procedure is about one, otherwise the user's home.
- Leave out `id`, `status`, `token`, `port` — the server fills them in.

## Start the server

Start it detached so it outlives this turn; it opens the page in the browser itself.

- Windows (PowerShell): `Start-Process node -ArgumentList '"<skill dir>\scripts\server.mjs"', '"<flow folder>\flow.json"' -WindowStyle Hidden`
- macOS/Linux: `nohup node "<skill dir>/scripts/server.mjs" "<flow folder>/flow.json" >/dev/null 2>&1 &`

Then tell the user, in one or two lines: the page opened, the flow folder name (so they can `/stepflow <name>` later to reopen it), and that **Export**/**Finish** on the page has Claude write up what worked, what didn't and what was confusing, saved as `runbook.md` in that folder and in the runbook library for next time. The URL contains a secret token and is saved with the port in `flow.json`, so reopening reuses it; don't print it unless the browser didn't open.

## How the spin-off behaves (so you can explain it)

- Runs `claude -p --permission-mode dontAsk` in the flow's `cwd`: the user's allow rules apply. Anything else it tries, file edits included, is blocked at once (no prompt, no PermissionRequest hooks) and shown under its reply with an **Allow & retry** button. For shell tools that allows that exact command for that step only; for tools without a command (e.g. Edit, Write, WebFetch, MCP tools) it allows the whole tool for that step, and the page labels those "whole tool".
- While it works, the panel shows the elapsed time and the tool it is running.
- **Summarize fix** turns the spin-off conversation into the step's lesson; the lesson field can also be edited by hand.
- State (statuses, threads, lessons) is in `flow.json`; nothing is lost by closing the tab or rebooting.
