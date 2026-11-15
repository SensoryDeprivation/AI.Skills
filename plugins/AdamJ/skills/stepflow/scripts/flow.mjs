// Flow file: load/normalize/save, serialized atomic updates, prompts and runbook.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

export function normalize(flow) {
  let changed = false;
  const fill = (obj, key, value) => {
    if (obj[key] === undefined) { obj[key] = value; changed = true; }
  };
  fill(flow, 'token', randomBytes(16).toString('hex'));
  fill(flow, 'cwd', homedir());
  fill(flow, 'steps', []);
  flow.steps.forEach((step, i) => {
    fill(step, 'id', `s${i + 1}`);
    fill(step, 'status', 'pending');
    fill(step, 'lesson', '');
    fill(step, 'allowed', []);
    fill(step, 'messages', []);
  });
  return changed;
}

function save(path, flow) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(flow, null, 2));
  renameSync(tmp, path);
}

export function loadFlow(path) {
  const flow = JSON.parse(readFileSync(path, 'utf8'));
  if (normalize(flow)) save(path, flow);
  return flow;
}

export function createStore(path) {
  const flow = loadFlow(path);
  let queue = Promise.resolve();
  return {
    flow,
    update(fn) {
      const run = queue.then(async () => {
        const result = await fn(flow);
        save(path, flow);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

const stepLine = (step, i) =>
  `${i + 1}. [${step.status}] ${step.title}` + (step.lesson ? `\n   Lesson: ${step.lesson}` : '');

export function contextPrompt(flow, stepId) {
  const index = flow.steps.findIndex(s => s.id === stepId);
  const step = flow.steps[index];
  return [
    'You are helping the user troubleshoot one step of a multi-step procedure (a "stepflow").',
    'The user runs the steps themselves; keep answers focused on getting this step working.',
    `Goal: ${flow.goal ?? ''}`,
    flow.context ? `Context: ${flow.context}` : '',
    'All steps:',
    flow.steps.map(stepLine).join('\n'),
    `You are helping the user with step ${index + 1}: ${step.title}`,
    'Step instructions:',
    step.body ?? '',
  ].filter(Boolean).join('\n\n');
}

export function statusLine(flow) {
  return 'Statuses now: ' + flow.steps.map((s, i) => `${i + 1} ${s.status}`).join(', ');
}

export function renderRunbook(flow) {
  const parts = [`# ${flow.title ?? 'Stepflow'}`, `**Goal:** ${flow.goal ?? ''}`];
  if (flow.context) parts.push(`**Context:** ${flow.context}`);
  flow.steps.forEach((s, i) => {
    parts.push(`## ${i + 1}. ${s.title} — ${s.status}`, s.body ?? '');
    if (s.lesson) parts.push(`> Lesson: ${s.lesson}`);
  });
  const attention = flow.steps
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => s.status === 'blocked' || s.lesson);
  parts.push('## Needed attention');
  parts.push(attention.length
    ? attention.map(({ s, n }) => `- Step ${n} (${s.title}) — ${s.status}${s.lesson ? `: ${s.lesson}` : ''}`).join('\n')
    : '- Nothing; every step worked as written.');
  return parts.join('\n\n') + '\n';
}
