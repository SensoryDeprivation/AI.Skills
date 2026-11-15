import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, loadFlow, createStore, contextPrompt, statusLine, renderRunbook } from '../scripts/flow.mjs';

const sample = () => ({
  title: 'Install X',
  goal: 'Get X running',
  context: 'Windows 11',
  steps: [
    { title: 'Install module', body: '```pwsh\nInstall-Module X\n```' },
    { title: 'Configure', body: 'Edit config' },
    { title: 'Verify', body: 'Run x --version' },
  ],
});

function tempFlow(flow = sample()) {
  const path = join(mkdtempSync(join(tmpdir(), 'stepflow-')), 'flow.json');
  writeFileSync(path, JSON.stringify(flow));
  return path;
}

test('normalize fills missing fields and is idempotent', () => {
  const flow = sample();
  assert.equal(normalize(flow), true);
  assert.deepEqual(flow.steps.map(s => s.id), ['s1', 's2', 's3']);
  for (const s of flow.steps) {
    assert.equal(s.status, 'pending');
    assert.equal(s.lesson, '');
    assert.deepEqual(s.allowed, []);
    assert.deepEqual(s.messages, []);
  }
  assert.match(flow.token, /^[0-9a-f]{32}$/);
  assert.ok(flow.cwd);
  const token = flow.token;
  assert.equal(normalize(flow), false);
  assert.equal(flow.token, token);
});

test('normalize keeps existing values', () => {
  const flow = sample();
  flow.steps[0].status = 'done';
  flow.steps[0].id = 'custom';
  flow.cwd = 'C:\\work';
  normalize(flow);
  assert.equal(flow.steps[0].status, 'done');
  assert.equal(flow.steps[0].id, 'custom');
  assert.equal(flow.cwd, 'C:\\work');
});

test('loadFlow saves normalized flow to disk', () => {
  const path = tempFlow();
  const flow = loadFlow(path);
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk.token, flow.token);
});

test('concurrent store updates both apply', async () => {
  const path = tempFlow();
  const store = createStore(path);
  await Promise.all([
    store.update(f => { f.steps[0].messages.push({ role: 'user', text: 'a' }); }),
    store.update(f => { f.steps[0].messages.push({ role: 'user', text: 'b' }); }),
  ]);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).steps[0].messages.length, 2);
});

test('contextPrompt includes other steps statuses and lessons', () => {
  const flow = sample();
  normalize(flow);
  flow.steps[0].status = 'done';
  flow.steps[0].lesson = 'Needed -Scope CurrentUser';
  const p = contextPrompt(flow, 's2');
  assert.match(p, /Get X running/);
  assert.match(p, /1\. \[done\] Install module/);
  assert.match(p, /Needed -Scope CurrentUser/);
  assert.match(p, /step 2: Configure/);
  assert.match(p, /Edit config/);
});

test('statusLine summarizes statuses', () => {
  const flow = sample();
  normalize(flow);
  flow.steps[0].status = 'done';
  flow.steps[1].status = 'blocked';
  assert.equal(statusLine(flow), 'Statuses now: 1 done, 2 blocked, 3 pending');
});

test('renderRunbook lists steps needing attention', () => {
  const flow = sample();
  normalize(flow);
  flow.steps[0].status = 'done';
  flow.steps[0].lesson = 'Needed -Scope CurrentUser';
  flow.steps[2].status = 'skipped';
  const md = renderRunbook(flow);
  assert.match(md, /^# Install X/);
  assert.match(md, /## 1\. Install module — done/);
  assert.match(md, /> Lesson: Needed -Scope CurrentUser/);
  const attention = md.slice(md.indexOf('Needed attention'));
  assert.match(attention, /Install module/);
  assert.doesNotMatch(attention, /Configure/);
});

test('normalize skips ids already used by hand-written steps', () => {
  const flow = { steps: [{ title: 'A' }, { id: 's1', title: 'B' }] };
  normalize(flow);
  const ids = flow.steps.map(s => s.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(flow.steps[1].id, 's1');
});

test('normalize rejects duplicate or unsafe hand-written ids', () => {
  assert.throws(() => normalize({ steps: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }), /duplicate/i);
  assert.throws(() => normalize({ steps: [{ id: 'a"><img src=x>', title: 'A' }] }), /invalid step id/i);
  assert.throws(() => normalize({ steps: [{ id: '../x', title: 'A' }] }), /invalid step id/i);
});

test('normalize resets unknown status to pending', () => {
  const flow = { steps: [{ title: 'A', status: '"><script>' }] };
  assert.equal(normalize(flow), true);
  assert.equal(flow.steps[0].status, 'pending');
});

test('loadFlow accepts a UTF-8 BOM', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'stepflow-')), 'flow.json');
  writeFileSync(path, '﻿' + JSON.stringify(sample()));
  assert.equal(loadFlow(path).steps.length, 3);
});
