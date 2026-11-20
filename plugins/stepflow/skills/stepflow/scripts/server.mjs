// Local stepflow server: `node server.mjs <flow.json> [--no-open]`.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore, contextPrompt, statusLine, renderRunbook, learningInput, hasLearnings, LEARN_PROMPT, STATUSES } from './flow.mjs';
import { runClaude } from './claude.mjs';

const PAGE = fileURLToPath(new URL('./page.html', import.meta.url));
const SUMMARIZE_PROMPT = 'Summarize the lesson from this conversation in 1-3 short lines: what was wrong with the step as written and what fixed it. Reply with only the lesson text.';

// Every export is also kept here, one file per flow, so later sessions can reuse it.
export const runbookLibrary = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'stepflow', 'runbooks');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', d => {
      data += d;
      if (data.length > 1e6) reject(new HttpError(413, 'Body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

async function isRunningFor(flow) {
  try {
    const res = await fetch(`http://127.0.0.1:${flow.port}/api/flow`, { headers: { 'x-stepflow-token': flow.token }, signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = err => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startServer(flowPath, { open = true, exitOnFinish = true } = {}) {
  flowPath = resolve(flowPath);
  const dir = dirname(flowPath);
  const store = createStore(flowPath);
  const { flow } = store;
  const busy = new Set();
  const progress = {}; // step id -> { since, tool, detail } while a turn runs
  let port;

  const findStep = id => {
    const step = flow.steps.find(s => s.id === id);
    if (!step) throw new HttpError(404, `No step ${id}`);
    return step;
  };

  // One spin-off turn. `record: false` keeps the exchange out of the visible thread.
  async function turn(step, text, { record = true } = {}) {
    if (busy.has(step.id)) throw new HttpError(409, 'Claude is still working on this step');
    busy.add(step.id);
    progress[step.id] = { since: new Date().toISOString() };
    try {
      const isFirst = !step.sessionId;
      const contextFile = join(dir, `context-${step.id}.md`);
      await store.update(() => {
        if (isFirst) {
          step.sessionId = randomUUID();
          writeFileSync(contextFile, contextPrompt(flow, step.id));
        }
        if (record) step.messages.push({ role: 'user', text, at: new Date().toISOString() });
      });
      const result = await runClaude({
        message: isFirst ? text : `${statusLine(flow)}\n\n${text}`,
        cwd: flow.cwd, sessionId: step.sessionId, isFirst, contextFile, allowed: step.allowed,
        onProgress: p => Object.assign(progress[step.id], p),
      });
      await store.update(() => {
        if (isFirst && result.error) step.sessionId = undefined; // let the next message start a fresh session
        if (record) step.messages.push({ role: 'assistant', text: result.text, denials: result.denials, error: result.error, at: new Date().toISOString() });
      });
      return result;
    } finally {
      busy.delete(step.id);
      delete progress[step.id];
    }
  }

  // A one-off claude turn (fresh session each export) that writes the "What we learned" section.
  async function learn() {
    if (!hasLearnings(flow)) return '';
    const contextFile = join(dir, 'context-learn.md');
    writeFileSync(contextFile, LEARN_PROMPT);
    const result = await runClaude({ message: learningInput(flow), cwd: dir, sessionId: randomUUID(), isFirst: true, contextFile, timeoutMs: 300000 });
    return result.error || !result.text.trim() ? `_Could not summarize the learnings: ${result.error || 'empty reply'}_` : result.text;
  }

  let exporting = false;
  async function exportRunbook() {
    if (exporting) throw new HttpError(409, 'An export is already running');
    exporting = true;
    try {
      const markdown = renderRunbook(flow, await learn());
      const path = join(dir, 'runbook.md');
      writeFileSync(path, markdown);
      const libraryPath = join(runbookLibrary(), `${basename(dir)}.md`);
      mkdirSync(dirname(libraryPath), { recursive: true });
      writeFileSync(libraryPath, markdown);
      return { path, libraryPath, markdown };
    } finally {
      exporting = false;
    }
  }

  const publicFlow = () => {
    const { token, ...rest } = flow;
    return { ...rest, busy: [...busy], progress };
  };

  async function route(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(PAGE));
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    if (req.headers['x-stepflow-token'] !== flow.token) throw new HttpError(403, 'Bad token');

    const body = req.method === 'POST' ? await readBody(req) : {};
    if (req.method === 'GET' && url.pathname === '/api/flow') return publicFlow();
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    if (url.pathname === '/api/export') return exportRunbook();
    if (url.pathname === '/api/finish') {
      const result = await exportRunbook();
      res.on('finish', () => { server.close(); if (exitOnFinish) process.exit(0); });
      return result;
    }

    const m = url.pathname.match(/^\/api\/steps\/([^/]+)\/(status|lesson|chat|allow|summarize)$/);
    if (!m) throw new HttpError(404, 'Not found');
    const step = findStep(decodeURIComponent(m[1]));
    switch (m[2]) {
      case 'status':
        if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status');
        await store.update(() => { step.status = body.status; });
        return publicFlow();
      case 'lesson':
        if (typeof body.lesson !== 'string') throw new HttpError(400, 'lesson must be a string');
        await store.update(() => { step.lesson = body.lesson; });
        return publicFlow();
      case 'chat':
        if (typeof body.message !== 'string' || !body.message.trim()) throw new HttpError(400, 'Empty message');
        await turn(step, body.message.trim());
        return { messages: step.messages };
      case 'allow':
        if (typeof body.rule !== 'string' || !body.rule) throw new HttpError(400, 'Missing rule');
        if (busy.has(step.id)) throw new HttpError(409, 'Claude is still working on this step');
        await store.update(() => { if (!step.allowed.includes(body.rule)) step.allowed.push(body.rule); });
        await turn(step, `Approved — retry: ${body.rule}`);
        return { messages: step.messages };
      case 'summarize': {
        if (!step.sessionId) throw new HttpError(400, 'No spin-off conversation on this step yet');
        const result = await turn(step, SUMMARIZE_PROMPT, { record: false });
        if (result.error) throw new HttpError(502, result.error);
        await store.update(() => { step.lesson = result.text.trim(); });
        return { lesson: step.lesson };
      }
    }
  }

  const server = createServer(async (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    // DNS-rebinding guard: only accept our own loopback origin.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(403, { error: 'Bad host' });
    try {
      const result = await route(req, res);
      if (!res.headersSent) send(200, result);
    } catch (err) {
      if (!res.headersSent) send(err.status ?? 500, { error: err.message });
    }
  });

  try {
    port = await listen(server, flow.port ?? 0);
  } catch (err) {
    if (err.code !== 'EADDRINUSE' || !flow.port) throw err;
    // A second server on the same flow would overwrite the first one's changes: reuse it instead.
    const url = `http://127.0.0.1:${flow.port}/?t=${flow.token}`;
    if (await isRunningFor(flow)) {
      if (open) openBrowser(url);
      return { url, reused: true, close() {} };
    }
    port = await listen(server, 0);
  }
  if (flow.port !== port) await store.update(() => { flow.port = port; });

  const url = `http://127.0.0.1:${port}/?t=${flow.token}`;
  if (open) openBrowser(url);
  return { url, close: () => server.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flowPath, ...flags] = process.argv.slice(2);
  if (!flowPath) {
    console.error('usage: node server.mjs <flow.json> [--no-open]');
    process.exit(2);
  }
  const { url, reused } = await startServer(flowPath, { open: !flags.includes('--no-open') });
  console.log(`Stepflow ${reused ? 'already running' : 'running'}: ${url}`);
}
