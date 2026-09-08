import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const baseline = 'no tsconfig reintroduces options TypeScript 7 removed';
function onlyKnownBaseline(status, output) {
  const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  return status === 1 && failures.length === 1 && failures[0] === baseline &&
    /^# fail 1$/m.test(output) && /^# cancelled 0$/m.test(output) &&
    output.includes('tsconfig.test.json still uses the removed node10 module resolution');
}

// Negative controls: new failures, a missing diagnostic and an abnormal runner exit
// must never be classified as the known baseline. The positive fixture also proves
// that a checker which always rejects cannot satisfy these controls.
const fixture = `not ok 1 - ${baseline}\n# fail 1\n# cancelled 0\ntsconfig.test.json still uses the removed node10 module resolution`;
assert.equal(onlyKnownBaseline(1, fixture), true);
assert.equal(onlyKnownBaseline(1, fixture + '\nnot ok 2 - new regression'), false);
assert.equal(onlyKnownBaseline(1, fixture.replace('# fail 1', '# fail 2')), false);
assert.equal(onlyKnownBaseline(1, fixture.replace('tsconfig.test.json still', 'missing')), false);
assert.equal(onlyKnownBaseline(null, fixture), false);
assert.equal(onlyKnownBaseline(2, fixture), false);
console.log('BASELINE_CHECKER_CONTROLS_OK=6');

const files = readdirSync('.test-build/tests', { recursive: true })
  .filter(file => file.endsWith('.test.js')).sort().map(file => path.join('.test-build/tests', file));
assert.ok(files.length > 0, 'No compiled tests');
const run = spawnSync(process.execPath, ['--require', './.test-build/tests/shims/ky.js', '--test', '--test-reporter=tap', ...files], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000,
});
process.stdout.write(run.stdout ?? '');
process.stderr.write(run.stderr ?? '');
assert.equal(run.error, undefined);
if (run.status === 0) process.exit(0);
assert.ok(onlyKnownBaseline(run.status, run.stdout), 'Full suite has a new or unclassified failure');
// Verify every source read by the failing test is exactly the committed baseline.
for (const file of ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.tools.json', 'tests/architecture/frameworkToolchainUpgrade.test.ts']) {
  const head = spawnSync('git', ['show', `HEAD:frontend/${file}`], { encoding: 'utf8' });
  assert.equal(head.status, 0);
  assert.equal(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), head.stdout.replace(/\r\n/g, '\n'));
}
console.log('ZERO_NEW_FAILURES: 1 verified unchanged TypeScript configuration baseline failure');
