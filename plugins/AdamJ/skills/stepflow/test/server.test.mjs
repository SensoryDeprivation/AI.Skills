import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/server.mjs';

const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
let server, flowPath, token, log;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stepflow-'));
  flowPath = join(dir, 'flow.json');
  log = join(dir, 'log.jsonl');
  writeFileSync(flowPath, JSON.stringify({
    title: 'T', goal: 'G', cwd: dir,
    steps: [{ title: 'One', body: 'do one' }, { title: 'Two', body: 'do two' }],
  }));
  process.env.STEPFLOW_CLAUDE = `node ${fake}`;
  process.env.FAKE_LOG = log;
  process.env.FAKE_MODE = 'ok';
  delete process.env.FAKE_DELAY;
  server = await startServer(flowPath, { open: false, exitOnFinish: false });
  token = JSON.parse(readFileSync(flowPath, 'utf8')).token;
});
afterEach(() => server.close());

function call(method, path, body, { headers = {}, auth = true } = {}) {
  const url = new URL(path, server.url);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { 'x-stepflow-token': token } : {}), ...headers },
    }, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data && res.headers['content-type']?.includes('json') ? JSON.parse(data) : data }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);

test('rejects API calls without token and never runs claude', async () => {
  assert.equal((await call('GET', '/api/flow', null, { auth: false })).status, 403);
  assert.equal((await call('POST', '/api/steps/s1/chat', { message: 'x' }, { auth: false })).status, 403);
  assert.equal(calls(), 0);
});

test('rejects foreign Host header', async () => {
  const r = await call('GET', '/api/flow', null, { headers: { host: 'evil.example:80' } });
  assert.equal(r.status, 403);
});

test('flow is returned without token; page is served', async () => {
  const r = await call('GET', '/api/flow');
  assert.equal(r.status, 200);
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.steps.length, 2);
  const page = await call('GET', '/?t=' + token, null, { auth: false });
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i);
});

test('status and lesson updates persist', async () => {
  assert.equal((await call('POST', '/api/steps/s1/status', { status: 'done' })).status, 200);
  assert.equal((await call('POST', '/api/steps/s1/status', { status: 'bogus' })).status, 400);
  assert.equal((await call('POST', '/api/steps/s9/status', { status: 'done' })).status, 404);
  await call('POST', '/api/steps/s2/lesson', { lesson: 'needs admin' });
  const flow = JSON.parse(readFileSync(flowPath, 'utf8'));
  assert.equal(flow.steps[0].status, 'done');
  assert.equal(flow.steps[1].lesson, 'needs admin');
});

test('chat appends messages; second turn resumes with status line', async () => {
  const r = await call('POST', '/api/steps/s1/chat', { message: 'it failed' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(r.body.messages[1].text, 'echo: it failed');
  const flow = JSON.parse(readFileSync(flowPath, 'utf8'));
  assert.ok(flow.steps[0].sessionId);
  assert.ok(existsSync(join(dirname(flowPath), 'context-s1.md')));
  await call('POST', '/api/steps/s1/chat', { message: 'again' });
  const second = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[1]);
  assert.ok(second.args.includes('--resume'));
  assert.match(second.input, /^Statuses now: /);
  assert.match(second.input, /again$/);
});

test('parallel chats on one step: one 200, one 409', async () => {
  process.env.FAKE_DELAY = '500';
  const results = await Promise.all([
    call('POST', '/api/steps/s1/chat', { message: 'a' }),
    call('POST', '/api/steps/s1/chat', { message: 'b' }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(calls(), 1);
});

test('claude error is recorded in thread', async () => {
  process.env.FAKE_MODE = 'fail';
  const r = await call('POST', '/api/steps/s1/chat', { message: 'x' });
  assert.equal(r.status, 200);
  assert.ok(r.body.messages[1].error);
});

test('allow adds rule and retries with allowedTools', async () => {
  await call('POST', '/api/steps/s1/chat', { message: 'x' });
  const r = await call('POST', '/api/steps/s1/allow', { rule: 'Bash(curl x)' });
  assert.equal(r.status, 200);
  const last = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));
  assert.equal(last.args[last.args.indexOf('--allowedTools') + 1], 'Bash(curl x)');
  assert.match(last.input, /Approved — retry: Bash\(curl x\)/);
  assert.deepEqual(JSON.parse(readFileSync(flowPath, 'utf8')).steps[0].allowed, ['Bash(curl x)']);
});

test('summarize sets lesson without adding to thread', async () => {
  await call('POST', '/api/steps/s1/chat', { message: 'x' });
  const r = await call('POST', '/api/steps/s1/summarize');
  assert.equal(r.status, 200);
  assert.ok(r.body.lesson);
  const step = JSON.parse(readFileSync(flowPath, 'utf8')).steps[0];
  assert.equal(step.lesson, r.body.lesson);
  assert.equal(step.messages.length, 2);
});

test('export writes runbook next to flow', async () => {
  const r = await call('POST', '/api/export');
  assert.equal(r.status, 200);
  assert.match(readFileSync(join(dirname(flowPath), 'runbook.md'), 'utf8'), /^# T/);
  assert.match(r.body.markdown, /Needed attention/);
});

test('restart reuses saved port', async () => {
  const port = new URL(server.url).port;
  server.close();
  await new Promise(r => setTimeout(r, 100));
  server = await startServer(flowPath, { open: false, exitOnFinish: false });
  assert.equal(new URL(server.url).port, port);
});

test('second server on the same flow reuses the running one', async () => {
  const again = await startServer(flowPath, { open: false, exitOnFinish: false });
  assert.equal(again.url, server.url);
  assert.equal(again.reused, true);
  again.close();
  assert.equal((await call('GET', '/api/flow')).status, 200);
});
