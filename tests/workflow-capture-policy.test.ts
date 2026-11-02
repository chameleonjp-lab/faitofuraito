import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
const captureBranch = 'codex/faito-share-acceptance';

function stepBlock(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow step exists: ${name}`);
  const endOffset = workflow.slice(start + marker.length).search(/\n      - /);
  return workflow.slice(start, endOffset < 0 ? workflow.length : start + marker.length + endOffset);
}

test('capture is triggered only by the exact work-branch push and cannot overlap main cancellation', () => {
  assert.match(workflow, new RegExp(`push:\\n    branches: \\[main, ${captureBranch}\\]`));
  assert.match(workflow, /concurrency:\n  group: flight-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/);
  assert.match(stepBlock('Install browser binaries for branch-only gameplay capture'), new RegExp(`if: github\.event_name == 'push' && github\.ref == 'refs/heads/${captureBranch}'`));
  assert.match(stepBlock('Capture anonymous share-preview gameplay (work branch only)'), new RegExp(`if: github\.event_name == 'push' && github\.ref == 'refs/heads/${captureBranch}'`));
  assert.match(stepBlock('Capture anonymous share-preview gameplay (work branch only)'), /run: node scripts\/capture-gameplay\.cjs/);
});

test('branch capture remains an artifact-only path; production deployment stays main-only', () => {
  const evidence = stepBlock('Preserve aircraft parity browser evidence');
  assert.match(evidence, /if: always\(\)/);
  assert.match(evidence, /path: \|\n\s+test-results\/\n\s+evidence\/faito-share-gameplay-capture\.png/);
  assert.doesNotMatch(evidence, /evidence\/\*\*/);
  assert.match(workflow, /- name: Upload verified production artifact\n        if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  assert.match(workflow, /  deploy:\n    if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  assert.match(workflow, /permissions:\n      contents: read\n      pages: write\n      id-token: write/);
});
