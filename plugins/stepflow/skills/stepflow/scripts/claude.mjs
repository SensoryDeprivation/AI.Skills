// Runs one `claude -p` turn for a step's spin-off. Never rejects: failures resolve with `error`.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';

// Windows: Node can't spawn npm's `claude.cmd` shim without a shell, and a shell would
// re-parse the allow rules (which contain commands). So find the real binary behind it.
export function resolveClaude(pathEnv = process.env.PATH ?? '', platform = process.platform) {
  if (platform !== 'win32') return ['claude', []];
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    if (existsSync(join(dir, 'claude.exe'))) return [join(dir, 'claude.exe'), []];
    if (!existsSync(join(dir, 'claude.cmd'))) continue;
    const pkg = join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
    try {
      const { bin } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
      const target = join(pkg, typeof bin === 'string' ? bin : bin.claude);
      if (existsSync(target)) return /\.[cm]?js$/.test(target) ? [process.execPath, [target]] : [target, []];
    } catch {}
  }
  return ['claude', []];
}

function claudeCommand() {
  const raw = process.env.STEPFLOW_CLAUDE;
  if (!raw) return resolveClaude();
  const space = raw.indexOf(' ');
  return space === -1 ? [raw, []] : [raw.slice(0, space), [raw.slice(space + 1)]];
}

function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

const toRule = d => (d.tool_input?.command ? `${d.tool_name}(${d.tool_input.command})` : d.tool_name);

export function runClaude({ message, cwd, sessionId, isFirst, contextFile, allowed = [], timeoutMs = 600000 }) {
  const [bin, lead] = claudeCommand();
  const args = [...lead, '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'];
  if (isFirst) args.push('--session-id', sessionId, '--append-system-prompt-file', contextFile);
  else args.push('--resume', sessionId);
  if (allowed.length) args.push('--allowedTools', ...allowed);

  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false, timedOut = false;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve({ sessionId, denials: [], text: '', ...result }); } };
    const child = spawn(bin, args, { cwd, windowsHide: true });
    // On timeout kill the whole tree (tool subprocesses too); resolve once the process has exited.
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => done({ error: `Could not start claude: ${err.message}` }));
    child.on('close', code => {
      if (timedOut) return done({ error: `Claude timed out after ${Math.round(timeoutMs / 1000)}s` });
      let r;
      try { r = JSON.parse(stdout); } catch {}
      if (!r || typeof r !== 'object') {
        return done({ error: `claude exited ${code}: ${(stderr || stdout).trim().slice(0, 2000) || 'no output'}` });
      }
      done({
        text: typeof r.result === 'string' ? r.result : '',
        sessionId: r.session_id ?? sessionId,
        denials: (Array.isArray(r.permission_denials) ? r.permission_denials : [])
          .filter(d => d && typeof d.tool_name === 'string')
          .map(d => ({ tool: d.tool_name, input: d.tool_input, rule: toRule(d) })),
        error: r.is_error ? (r.result || `claude reported an error (${r.subtype ?? 'unknown'})`) : undefined,
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(message);
  });
}
