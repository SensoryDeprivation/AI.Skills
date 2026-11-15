import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../scripts/claude.mjs';

const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
let log;
beforeEach(() => {
  log = join(mkdtempSync(join(tmpdir(), 'stepflow-')), 'log.jsonl');
  process.env.STEPFLOW_CLAUDE = `node ${fake}`;
  process.env.FAKE_LOG = log;
  process.env.FAKE_MODE = 'ok';
});
const lastCall = () => JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));
const base = { message: 'hi', cwd: tmpdir(), sessionId: '11111111-1111-1111-1111-111111111111' };

test('first turn starts session with context file', async () => {
  const r = await runClaude({ ...base, isFirst: true, contextFile: 'ctx.md', allowed: [] });
  const { args, input } = lastCall();
  assert.ok(args.includes('-p'));
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'acceptEdits']);
  assert.equal(args[args.indexOf('--session-id') + 1], base.sessionId);
  assert.equal(args[args.indexOf('--append-system-prompt-file') + 1], 'ctx.md');
  assert.ok(!args.includes('--resume'));
  assert.ok(!args.includes('--allowedTools'));
  assert.equal(input, 'hi');
  assert.equal(r.text, 'echo: hi');
  assert.equal(r.sessionId, base.sessionId);
  assert.equal(r.error, undefined);
});

test('later turn resumes and passes allowed tools', async () => {
  await runClaude({ ...base, isFirst: false, allowed: ['Bash(curl x)'] });
  const { args } = lastCall();
  assert.equal(args[args.indexOf('--resume') + 1], base.sessionId);
  assert.ok(!args.includes('--session-id'));
  assert.ok(!args.includes('--append-system-prompt-file'));
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Bash(curl x)');
});

test('denials map to allow rules', async () => {
  process.env.FAKE_MODE = 'deny';
  const r = await runClaude({ ...base, isFirst: false, allowed: [] });
  assert.deepEqual(r.denials, [{ tool: 'Bash', input: { command: 'curl x' }, rule: 'Bash(curl x)' }]);
});

test('malformed denials are ignored, reply kept', async () => {
  process.env.FAKE_MODE = 'baddenials';
  const r = await runClaude({ ...base, isFirst: false, allowed: [] });
  assert.equal(r.text, 'x');
  assert.deepEqual(r.denials, []);
});

for (const mode of ['bad', 'fail', 'null']) {
  test(`${mode} output resolves with error`, async () => {
    process.env.FAKE_MODE = mode;
    const r = await runClaude({ ...base, isFirst: false, allowed: [] });
    assert.ok(r.error);
  });
}

test('missing binary resolves with error', async () => {
  process.env.STEPFLOW_CLAUDE = 'definitely-not-a-real-binary-xyz';
  const r = await runClaude({ ...base, isFirst: false, allowed: [] });
  assert.ok(r.error);
});

test('timeout kills and resolves with error', async () => {
  process.env.FAKE_DELAY = '3000';
  const r = await runClaude({ ...base, isFirst: false, allowed: [], timeoutMs: 300 });
  delete process.env.FAKE_DELAY;
  assert.match(r.error, /timed out/i);
});

test('timeout kills the whole process tree', async () => {
  const mark = join(mkdtempSync(join(tmpdir(), 'stepflow-')), 'mark');
  process.env.FAKE_MODE = 'grandchild';
  process.env.FAKE_MARK = mark;
  const r = await runClaude({ ...base, isFirst: false, allowed: [], timeoutMs: 500 });
  assert.match(r.error, /timed out/i);
  await new Promise(res => setTimeout(res, 2000));
  assert.equal(existsSync(mark), false, 'grandchild survived the timeout');
});
