// Runs one `claude -p` turn for a step's spin-off. Never rejects: failures resolve with `error`.
import { spawn } from 'node:child_process';

function claudeCommand() {
  const raw = process.env.STEPFLOW_CLAUDE ?? 'claude';
  const space = raw.indexOf(' ');
  return space === -1 ? [raw, []] : [raw.slice(0, space), [raw.slice(space + 1)]];
}

const toRule = d => (d.tool_input?.command ? `${d.tool_name}(${d.tool_input.command})` : d.tool_name);

export function runClaude({ message, cwd, sessionId, isFirst, contextFile, allowed = [], timeoutMs = 600000 }) {
  const [bin, lead] = claudeCommand();
  const args = [...lead, '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'];
  if (isFirst) args.push('--session-id', sessionId, '--append-system-prompt-file', contextFile);
  else args.push('--resume', sessionId);
  if (allowed.length) args.push('--allowedTools', ...allowed);

  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve({ sessionId, denials: [], text: '', ...result }); } };
    const child = spawn(bin, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done({ error: `Claude timed out after ${Math.round(timeoutMs / 1000)}s` }); }, timeoutMs);
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => done({ error: `Could not start claude: ${err.message}` }));
    child.on('close', code => {
      let r;
      try { r = JSON.parse(stdout); } catch {
        return done({ error: `claude exited ${code}: ${(stderr || stdout).trim().slice(0, 2000) || 'no output'}` });
      }
      done({
        text: r.result ?? '',
        sessionId: r.session_id ?? sessionId,
        denials: (r.permission_denials ?? []).map(d => ({ tool: d.tool_name, input: d.tool_input, rule: toRule(d) })),
        error: r.is_error ? (r.result || `claude reported an error (${r.subtype ?? 'unknown'})`) : undefined,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(message);
  });
}
