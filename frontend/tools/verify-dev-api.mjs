import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const out = '.test-build/dev-api-mutations';
mkdirSync(out, { recursive: true });
const proxy = 'tools/dev-api-proxy.mjs';
const client = 'src/services/api/client.ts';
const mutants = [
  [client, 'process.env.NEXT_PUBLIC_DEV_API_PROXY === "true"', 'process.env.NEXT_PUBLIC_DEV_API_PROXY === "disabled"', 'api-resolution', 'localhost-resolution'],
  [client, 'process.env.NODE_ENV === "development" &&', 'true &&', 'api-resolution', 'production-isolation'],
  [client, 'if (configuredApiBase) return configuredApiBase.replace(/\\/+$/, "");', 'if (configuredApiBase) return "http://wrong.invalid";', 'api-resolution', 'server-upstream'],
  [proxy, 'if (origin && origin !== `http://${req.headers.host}`) return false;', 'if (false) return false;', 'proxy', 'origin-protection'],
  [proxy, "method: req.method, path: req.url,", "method: req.method, path: req.url.split('?')[0],", 'proxy', 'query-fidelity'],
  [proxy, "headersFor(incoming.headers));", "{ ...headersFor(incoming.headers), 'set-cookie': [] });", 'proxy', 'session-cookies'],
];
for (const [file, before, after, suite, name] of mutants) {
  const original = readFileSync(file, 'utf8');
  assert.equal(original.split(before).length, 2, `Mutant must match exactly once: ${name}`);
  const mutated = original.replace(before, after);
  const workspace = path.resolve(out, name);
  for (const source of [proxy, client, 'tests/dev/api-resolution.test.mjs', 'tests/dev/proxy.test.mjs']) {
    const destination = path.join(workspace, source);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, source === file ? mutated : readFileSync(source));
  }
  {
    assert.equal(readFileSync(path.join(workspace, file), 'utf8'), mutated);
    // A fresh Node process loads each changed source; no module/bytecode cache is reused.
    const pattern = suite === 'proxy' ? 'no-open-proxy|request-response-fidelity' : '.*';
    const run = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}`, `tests/dev/${suite}.test.mjs`], { cwd: workspace, encoding: 'utf8', timeout: 15000 });
    writeFileSync(`${out}/${name}.log`, run.stdout + run.stderr);
    assert.equal(run.error, undefined, `${name}: test process did not execute normally`);
    assert.equal(run.status, 1, `${name}: expected assertion failure, received ${run.status}`);
    assert.match(run.stdout + run.stderr, /AssertionError/, `${name}: must fail a behavioral assertion`);
    console.log(`KILLED ${name} sha256=${createHash('sha256').update(mutated).digest('hex')}`);
  }
  assert.equal(readFileSync(file, 'utf8'), original, `Source changed during mutation: ${name}`);
}
console.log(`MANUAL_MUTATION_OK=${mutants.length}/${mutants.length}`);
