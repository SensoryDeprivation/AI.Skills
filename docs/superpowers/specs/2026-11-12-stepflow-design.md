# Stepflow — Design

**Date:** 2026-11-12
**Author:** Adam Jaszczurowski
**Status:** Draft, awaiting approval

## Intent

When Claude gives Adam a multi-step procedure (pwsh, bash, click-through in some UI, anything), one step often fails: the UI differs, a module or library is missing, permissions are wrong. Today Adam troubleshoots in the main chat. Then he either scrolls back to find the remaining steps (tedious, and worse after a second failure) or asks Claude to regenerate them (wastes tokens and context).

Stepflow keeps the steps and the troubleshooting apart: a local page shows the steps one at a time, and any step can spin off its own Claude conversation that knows the whole story. At the end, an export captures what worked and what needed fixing, so the next run of the same procedure starts with those lessons already applied.

Adam has a similar tool on his Mac (a local server per stepflow, exposing the page). This one is for him, on this Windows machine, shipped as a skill in this repo's `AdamJ` plugin.

## Goals

1. Claude turns a multi-step procedure into a stepflow and gives Adam a localhost URL.
2. The page shows steps top to bottom. Only the active step is expanded.
3. Each step can be marked **Done**, **Blocked** or **Skipped**. Done (and Skipped) collapses the current step and expands the next unfinished one.
4. Each step has a spin-off chat with Claude. Enter sends; Shift+Enter is a newline. The spin-off Claude knows the goal, all steps, their statuses, and which step this is, and **can use tools** (run commands, read files) to diagnose.
5. The fix found in a spin-off can be recorded on the step as a lesson.
6. Export produces a markdown runbook: what worked as written, what needed attention and how it was fixed, what was skipped. Handing that runbook to Claude on the next run produces new steps with the lessons built in.
7. Progress survives closing the tab or restarting the server.

## Non-goals (MVP)

- Hosting, sharing, multiple users, auth beyond localhost protection.
- Streaming spin-off replies token by token (a "working…" indicator is enough).
- Editing, reordering or adding steps from the page.
- A list/dashboard of past stepflows.
- macOS/Linux polish (should work, not tested).

## Anti-goals

- The main Claude conversation should not need to regenerate steps after a failure. If using stepflow costs as many tokens as the current way, it has failed.
- Any web page Adam visits must not be able to drive the tool-enabled spin-off through the localhost server.

## Decided (by Adam)

- Local server per stepflow, page on localhost (as on his Mac).
- Steps can be any kind: shell commands or UI click-throughs.
- Collapse/expand behaviour and Enter-to-send as in Goals.
- Spin-off chat lives in the page and runs through `claude -p` (his Claude Code login, no API key), with tool access.

## Claude's calls (Adam can override)

- **Packaging:** a skill at `plugins/AdamJ/skills/stepflow/` containing `SKILL.md`, `server.mjs`, `page.html`. Node (v24 is installed), no npm dependencies.
- **Trigger:** Adam invokes `/stepflow` (optionally with a previous runbook). Claude does not create stepflows unprompted.
- **Storage:** one folder per stepflow under `~/.stepflow/<yyyy-mm-dd>-<slug>/`, holding `flow.json` (state) and `runbook.md` (export). Kept out of project repos.
- **Flow file:** `{ title, goal, context, cwd, token, port, steps: [{ id, title, body, status, lesson, sessionId, allowed, messages }] }`. `body` is markdown (code blocks get a copy button). `cwd` is where the spin-off Claude runs. Writes are serialized in the server and atomic (temp file + rename).
- **Server:** `node server.mjs <flow.json>` binds 127.0.0.1 on a free port, prints the URL, runs until killed. Claude starts it in the background.
- **Localhost protection:** a random token is generated when the flow is created and saved in `flow.json`; the URL carries it and every API call must send it, otherwise 403. The server also rejects requests whose `Host` header isn't `127.0.0.1:<port>`/`localhost:<port>` (DNS-rebinding guard). The token is never logged. This blocks other sites from triggering tool-enabled Claude runs.
- **Resume:** `/stepflow <slug or folder>` restarts the server for an existing flow; the server reuses the port saved in `flow.json` if free, so the old URL keeps working. Costs the main conversation only the restart command.
- **Spin-off mechanics:** first message runs `claude -p --output-format json --session-id <new uuid> --append-system-prompt <flow context>` with the message on stdin; later messages use `--resume <sessionId>`. Context = goal, the full step list with statuses and lessons, and "you are helping with step N". Runs in the flow's `cwd`. Messages and the session id are stored in `flow.json`.
- **Blocked:** marking a step Blocked keeps it expanded and opens its spin-off.
- **Lesson capture:** each step has an editable lesson field plus a "Summarize fix" button that asks the step's spin-off session for a one-to-three line lesson and fills the field.
- **Export:** button writes `runbook.md` and shows/downloads it. Format: goal, then each step with its original instruction, status, and lesson. SKILL.md tells Claude, when given a runbook, to fold lessons into the steps (fix commands, add missing prerequisite steps, drop steps that were skipped as unnecessary) rather than appending them as notes.

## Spin-off permissions (decided 2026-11-15, option (a))

- Spin-offs run with `--permission-mode acceptEdits`, so Adam's existing allow rules apply and file edits are allowed.
- Calls that aren't allowed are refused, and `claude -p --output-format json` reports them in `permission_denials` (`tool_name`, `tool_input`). This was checked on this machine. The page lists them under the reply with an **Allow & retry** button. That adds the exact rule (`<tool_name>(<tool_input.command>)`, or just `<tool_name>` when there's no command) to the step's `allowed` list and resumes the session with `--allowedTools` set to that list and the message "Approved — retry: <command>".
- Verified: the system prompt passed on the first message is fixed for the session, and resuming doesn't update it. Later messages therefore start with a one-line summary of current statuses.
- **Finish** button: writes the runbook, then stops the server.

## Left to the builder

Page styling, markdown renderer details (minimal is fine: headings, lists, inline code, fenced code), port selection, error display when `claude` fails or times out.
