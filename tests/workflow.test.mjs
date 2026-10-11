// Checks the scoring logic inside "lead management.json" without running n8n.
// It reads the n8n expressions and the Code node from the workflow file and
// evaluates them with stand-ins for $json, $('Node').first() and $input.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = JSON.parse(
  readFileSync(new URL('../lead management.json', import.meta.url), 'utf8')
);
const node = (name) => workflow.nodes.find((n) => n.name === name);
const assignment = (nodeName, field) =>
  node(nodeName).parameters.assignments.assignments.find((a) => a.name === field).value;

const config = Object.fromEntries(
  node('Config').parameters.assignments.assignments.map((a) => [a.name, a.value])
);

/** Evaluates an n8n "={{ ... }}" expression. `nodes` maps node names to their first item's json. */
function evaluate(expression, { json = {}, nodes = {}, now = Date.now(), executionId = '1' } = {}) {
  const body = expression.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const $ = (name) => ({ first: () => ({ json: nodes[name] }) });
  const $now = { toMillis: () => now, toISO: () => new Date(now).toISOString() };
  const $execution = { id: executionId };
  return new Function('$json', '$', '$now', '$execution', `return (${body});`)(json, $, $now, $execution);
}

function ruleScore(lead) {
  return evaluate(assignment('Hybrid Score', 'rule_score'), { nodes: { 'Generate Lead ID': lead } });
}

function finalScore(scores) {
  const nodes = { Config: config };
  return {
    score: evaluate(assignment('Final Score', 'final_score'), { json: scores, nodes }),
    category: evaluate(assignment('Final Score', 'category'), { json: scores, nodes }),
  };
}

function parseAiResponse(response) {
  const run = new Function('$input', node('Parse AI Response').parameters.jsCode);
  return run({ item: { json: response } }).json;
}

const geminiReply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

test('two leads in the same millisecond get different IDs', () => {
  const expression = assignment('Generate Lead ID', 'lead_id');
  const now = 1791518069546;
  const first = evaluate(expression, { now, executionId: '481' });
  const second = evaluate(expression, { now, executionId: '482' });
  assert.match(first, /^LEAD-1791518069546-481$/);
  assert.notEqual(first, second);
});

test('the strongest lead gets the maximum rule score', () => {
  assert.equal(ruleScore({ budget: 5000, employees: 201, message: 'Ready to start now' }), 100);
});

test('the weakest lead gets the minimum rule score', () => {
  // 5 + 5 + 5 = 15 out of 80 → 19 out of 100
  assert.equal(ruleScore({ budget: 0, employees: 0, message: '' }), 19);
});

test('intent keywords match whole words only', () => {
  const base = { budget: 0, employees: 0 };
  // "know" must not count as "now" (fixed in v2)
  assert.equal(ruleScore({ ...base, message: 'Let me know' }), 19);
  assert.equal(ruleScore({ ...base, message: 'We can start now' }), 50); // 5+5+30
  assert.equal(ruleScore({ ...base, message: 'We need automation' }), 38); // 5+5+20
  assert.equal(ruleScore({ ...base, message: 'Just interested' }), 25); // 5+5+10
});

test('budget and company-size tiers match the README', () => {
  const s = (budget, employees) => ruleScore({ budget, employees, message: '' });
  assert.equal(s(2000, 0), ruleScore({ budget: 4999, employees: 0, message: '' }));
  assert.ok(s(5000, 0) > s(2000, 0) && s(2000, 0) > s(500, 0) && s(500, 0) > s(499, 0));
  assert.ok(s(0, 201) > s(0, 200) && s(0, 51) > s(0, 50) && s(0, 11) > s(0, 10));
});

test('final score is 60% rules + 40% AI, with HOT/WARM/COLD thresholds', () => {
  assert.deepEqual(finalScore({ ai_ok: true, rule_score: 100, ai_score: 50 }), { score: 80, category: 'HOT' });
  assert.deepEqual(finalScore({ ai_ok: true, rule_score: 50, ai_score: 50 }), { score: 50, category: 'WARM' });
  assert.deepEqual(finalScore({ ai_ok: true, rule_score: 40, ai_score: 40 }), { score: 40, category: 'COLD' });
});

test('if the AI fails, the rule score is used on its own', () => {
  assert.deepEqual(finalScore({ ai_ok: false, rule_score: 81, ai_score: null }), { score: 81, category: 'HOT' });
});

test('Parse AI Response reads plain and fenced JSON and clamps the score', () => {
  const plain = parseAiResponse(geminiReply('{"score": 72, "reason": "Fits", "priority": "high"}'));
  assert.equal(plain.ai_ok, true);
  assert.equal(plain.ai_score, 72);
  assert.equal(plain.ai_priority, 'HIGH');

  const fenced = parseAiResponse(geminiReply('```json\n{"score": 140}\n```'));
  assert.equal(fenced.ai_score, 100);
});

test('Parse AI Response falls back when the AI call failed or the answer is unreadable', () => {
  for (const response of [{ error: { message: 'timeout' } }, geminiReply('Sorry, I cannot help.'), geminiReply('{"score":"high"}')]) {
    const parsed = parseAiResponse(response);
    assert.equal(parsed.ai_ok, false);
    assert.equal(parsed.ai_score, null);
  }
});

test('every connection points at a node that exists', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), `unknown source node: ${source}`);
    for (const branch of outputs.main) {
      for (const target of branch || []) assert.ok(names.has(target.node), `unknown target node: ${target.node}`);
    }
  }
});

test('the sheet columns cover every field Save to CRM writes', () => {
  const columns = readFileSync(new URL('../crm-columns.csv', import.meta.url), 'utf8').trim().split(',');
  const mapped = Object.keys(node('Save to CRM').parameters.columns?.value || {});
  assert.ok(mapped.length > 0, 'Save to CRM has no column mapping');
  for (const field of mapped) assert.ok(columns.includes(field), `column missing from crm-columns.csv: ${field}`);
});

test('daily summary counts the last 24 hours and lists due follow-ups', () => {
  const summary = JSON.parse(
    readFileSync(new URL('../extras/daily-lead-summary.json', import.meta.url), 'utf8')
  );
  const code = summary.nodes.find((n) => n.name === 'Build Summary').parameters.jsCode;
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const rows = [
    { lead_id: 'LEAD-1', name: 'A', category: 'HOT', score: 85, created_at: hoursAgo(2) },
    { lead_id: 'LEAD-2', name: 'B', category: 'cold', score: 20, created_at: hoursAgo(5) },
    { lead_id: 'LEAD-3', name: 'C', category: 'WARM', score: 60, created_at: hoursAgo(48), next_followup: '2000-01-01', status: 'NEW' },
    { lead_id: 'LEAD-4', name: 'D', category: 'WARM', created_at: hoursAgo(48), next_followup: '2000-01-01', status: 'Closed' },
    {}, // the empty item Read CRM returns when the sheet has no rows
  ];
  const [out] = new Function('$input', code)({ all: () => rows.map((json) => ({ json })) });
  assert.equal(out.json.subject, 'Daily lead summary: 2 new, 1 HOT');
  assert.match(out.json.body, /HOT: 1 \| WARM: 0 \| COLD: 1/);
  assert.match(out.json.body, /- C \(\) \| due 2000-01-01/);
  assert.doesNotMatch(out.json.body, /- D /);
});

test('Parse AI Response does not read a missing or empty score as 0', () => {
  // Number(null), Number('') and Number(false) are all 0, which used to count as a
  // real AI score and pull a HOT lead down to WARM.
  for (const score of ['null', '""', 'false', 'true', '[]']) {
    const parsed = parseAiResponse(geminiReply(`{"score": ${score}, "reason": "?"}`));
    assert.equal(parsed.ai_ok, false, `score ${score}`);
    assert.equal(parsed.ai_score, null, `score ${score}`);
  }
  assert.equal(parseAiResponse(geminiReply('{"score": "85"}')).ai_score, 85);
});

test('Save to CRM writes text that starts with = + - @ as plain text, not a formula', () => {
  // The sheet is written with "Let Google Sheets format" (USER_ENTERED), so a value
  // like "+20 100 123 4567" or "=IMPORTDATA(...)" would be read as a formula.
  // A leading apostrophe makes Sheets keep it as text (the apostrophe isn't shown).
  const mapping = node('Save to CRM').parameters.columns.value;
  const write = (field, value) => evaluate(mapping[field], { json: { [field]: value } });

  assert.equal(write('phone', '+20 100 123 4567'), "'+20 100 123 4567");
  assert.equal(write('name', '=IMPORTDATA("https://example.com")'), `'=IMPORTDATA("https://example.com")`);
  assert.equal(write('message', '- we need a CRM'), "'- we need a CRM");
  assert.equal(write('company', '@acme'), "'@acme");
  assert.equal(write('name', 'Sara Ali'), 'Sara Ali');
  assert.equal(write('phone', ''), '');

  for (const field of ['name', 'email', 'phone', 'company', 'industry', 'service', 'message', 'source', 'reason', 'recommended_action']) {
    assert.equal(write(field, '=1+1'), "'=1+1", `${field} is not protected`);
  }
});

test('workflow files contain no credentials, instance IDs or real contact details', () => {
  const files = ['../lead management.json', '../extras/daily-lead-summary.json', '../extras/error-alert.json'];
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const flow = JSON.parse(text);
    assert.equal(flow.meta?.instanceId, undefined, `${file}: meta.instanceId`);
    for (const n of flow.nodes) assert.equal(n.credentials, undefined, `${file}: credentials on ${n.name}`);
    for (const email of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []) {
      assert.match(email, /@example\.com$/, `${file}: real email address ${email}`);
    }
    // Phone numbers: 10+ digits, optionally with a leading + and spaces (UUIDs use dashes).
    assert.doesNotMatch(text, /\+?\b\d[\d ]{9,}\d\b/, `${file}: looks like a phone number`);
  }
});
