// Stand-in for `claude -p` in tests. Logs argv + stdin, prints JSON per FAKE_MODE.
import { appendFileSync } from 'node:fs';

let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', async () => {
  const args = process.argv.slice(2);
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, input }) + '\n');
  if (process.env.FAKE_DELAY) await new Promise(r => setTimeout(r, Number(process.env.FAKE_DELAY)));
  const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1];
  const mode = process.env.FAKE_MODE ?? 'ok';
  if (mode === 'bad') return process.stdout.write('not json');
  if (mode === 'null') return process.stdout.write('null');
  if (mode === 'baddenials') return process.stdout.write(JSON.stringify({ result: 'x', permission_denials: 'nope' }));
  if (mode === 'grandchild') {
    // Simulates a tool subprocess that outlives a timeout kill unless the whole tree is killed.
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, ['-e', `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(process.env.FAKE_MARK)}, 'alive'), 1500)`], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 5000));
  }
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(1); }
  const denials = mode === 'deny'
    ? [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'curl x' } }]
    : [];
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: `echo: ${input}`, session_id: sid, permission_denials: denials }));
});
