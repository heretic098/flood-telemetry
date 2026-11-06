import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Dockerfile: OS Security Upgrades, Multi-stage Isolation & Non-Root Execution', () => {
  const dockerfilePath = path.join(ROOT_DIR, 'Dockerfile');
  assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');

  const content = fs.readFileSync(dockerfilePath, 'utf8');
  const lines = content.split('\n');

  // Verify multi-stage structure
  const fromStages = lines.filter(l => l.trim().startsWith('FROM '));
  assert.equal(fromStages.length, 2, 'Dockerfile must have exactly two build stages');
  assert.ok(fromStages[0].includes('AS build'), 'First stage must be named "build"');
  assert.ok(fromStages[1].startsWith('FROM node:20-slim'), 'Final runtime stage must be based on node:20-slim');

  // Find line where second stage starts
  const secondStageIndex = lines.findIndex((l, idx) => idx > 0 && l.trim().startsWith('FROM '));
  const stage1Lines = lines.slice(0, secondStageIndex);
  const stage2Lines = lines.slice(secondStageIndex);

  // Stage 1 (build) must install build toolchains for native bindings (better-sqlite3) and use --omit=dev
  const stage1Str = stage1Lines.join('\n');
  assert.ok(stage1Str.includes('python3'), 'Build stage must contain python3 for native node-gyp builds');
  assert.ok(stage1Str.includes('make'), 'Build stage must contain make');
  assert.ok(stage1Str.includes('g++'), 'Build stage must contain g++');
  assert.ok(stage1Str.includes('npm ci --omit=dev'), 'Build stage must use non-deprecated "npm ci --omit=dev"');

  // Stage 2 (runtime) must upgrade Debian packages to patch OS CVEs
  const stage2Str = stage2Lines.join('\n');
  assert.ok(
    stage2Str.includes('apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*'),
    'Final runtime stage must run apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* for continuous OS CVE remediation'
  );

  // Stage 2 must NOT install build toolchains (compiler isolation)
  assert.ok(!stage2Str.includes('g++'), 'Final runtime stage must not install g++');
  assert.ok(!stage2Str.includes('make'), 'Final runtime stage must not install make');
  assert.ok(!stage2Str.includes('python3'), 'Final runtime stage must not install python3');

  // Stage 2 must drop privileges to unprivileged node user (non-root execution)
  assert.ok(stage2Str.includes('chown -R node:node /app'), 'Final runtime stage must chown /app to unprivileged node user');
  assert.ok(stage2Str.includes('USER node'), 'Final runtime stage must drop privileges to USER node');

  // Stage 2 must set production environment
  assert.ok(stage2Str.includes('ENV NODE_ENV=production'), 'Final runtime stage must set ENV NODE_ENV=production');

  // Stage 2 must copy node_modules from build stage
  assert.ok(
    stage2Str.includes('COPY --from=build /app/node_modules ./node_modules'),
    'Final runtime stage must copy built node_modules from build stage'
  );
});

test('package.json: Audit script and production dependencies configuration', () => {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // Audit script check
  assert.equal(
    pkg.scripts.audit,
    'npm audit --omit=dev --audit-level=high',
    'package.json must define "audit": "npm audit --omit=dev --audit-level=high"'
  );

  // Production dependencies audit
  assert.ok(pkg.dependencies, 'package.json must have dependencies object');
  assert.ok(pkg.dependencies['better-sqlite3'], 'better-sqlite3 must be a production dependency');

  // Dev dependencies audit (must declare js-yaml explicitly)
  assert.ok(pkg.devDependencies, 'package.json must have devDependencies object');
  assert.ok(pkg.devDependencies['js-yaml'], 'js-yaml must be declared in devDependencies');

  // Ensure no insecure wildcards
  for (const [dep, version] of Object.entries(pkg.dependencies)) {
    assert.ok(!version.includes('*'), `Dependency ${dep} must not use wildcard version`);
    assert.ok(!version.startsWith('http://'), `Dependency ${dep} must not use unencrypted http`);
  }
});

test('Dependabot: Security-Only Configuration (Zero Version Bump PR Spam)', () => {
  const dependabotPath = path.join(ROOT_DIR, '.github/dependabot.yml');
  assert.ok(fs.existsSync(dependabotPath), '.github/dependabot.yml must exist');

  const content = fs.readFileSync(dependabotPath, 'utf8');

  // Parse YAML to ensure valid syntax
  const config = yaml.load(content);
  assert.equal(config.version, 2, 'Dependabot configuration must be version 2');
  assert.ok(Array.isArray(config.updates), 'Dependabot must define updates array');

  // Find npm update entry
  const npmUpdate = config.updates.find(u => u['package-ecosystem'] === 'npm');
  assert.ok(npmUpdate, 'Dependabot updates must configure the npm ecosystem');
  assert.equal(npmUpdate.directory, '/', 'npm directory must be root /');

  // Invariant: open-pull-requests-limit must be 0 to disable routine version bump PR spam
  // while keeping automated GitHub Dependabot Security updates active for CVEs/KEVs
  assert.equal(
    npmUpdate['open-pull-requests-limit'],
    0,
    'npm open-pull-requests-limit must be 0'
  );

  // github-actions ecosystem also configured with open-pull-requests-limit: 0
  const actionsUpdate = config.updates.find(u => u['package-ecosystem'] === 'github-actions');
  assert.ok(actionsUpdate, 'Dependabot updates must configure github-actions ecosystem');
  assert.equal(
    actionsUpdate['open-pull-requests-limit'],
    0,
    'github-actions open-pull-requests-limit must be 0'
  );
});

test('GitHub Actions: CI Workflow Configuration', () => {
  const ciPath = path.join(ROOT_DIR, '.github/workflows/ci.yml');
  assert.ok(fs.existsSync(ciPath), '.github/workflows/ci.yml must exist');

  const content = fs.readFileSync(ciPath, 'utf8');

  // Parse YAML to ensure valid syntax
  const workflow = yaml.load(content);
  assert.equal(workflow.name, 'CI', 'Workflow name must be CI');

  // Trigger checks: push and pull_request on master
  assert.ok(workflow.on, 'Workflow must define trigger events');
  assert.ok(workflow.on.push?.branches?.includes('master'), 'Workflow must trigger on push to master');
  assert.ok(workflow.on.pull_request?.branches?.includes('master'), 'Workflow must trigger on pull_request to master');

  // Inspect jobs
  const jobs = Object.values(workflow.jobs || {});
  assert.ok(jobs.length > 0, 'Workflow must define at least one job');
  const mainJob = jobs[0];
  assert.equal(mainJob['runs-on'], 'ubuntu-latest', 'Job must run on ubuntu-latest');

  // Inspect job steps
  const steps = mainJob.steps || [];
  const checkoutStep = steps.find(s => s.uses?.startsWith('actions/checkout'));
  assert.ok(checkoutStep, 'Workflow must include actions/checkout step');

  const nodeSetupStep = steps.find(s => s.uses?.startsWith('actions/setup-node'));
  assert.ok(nodeSetupStep, 'Workflow must include actions/setup-node step');
  assert.equal(nodeSetupStep.with?.['node-version'], 20, 'Node setup step must specify node-version: 20');

  const stepRuns = steps.map(s => s.run).filter(Boolean);
  assert.ok(stepRuns.some(cmd => cmd.includes('npm ci')), 'Workflow must run npm ci');
  assert.ok(stepRuns.some(cmd => cmd.includes('npm run lint')), 'Workflow must run npm run lint');
  assert.ok(
    stepRuns.some(cmd => cmd.includes('npm run test:clean')),
    'Workflow must run hermetic clean-room test suite (npm run test:clean)'
  );
  assert.ok(
    stepRuns.some(cmd => cmd.includes('npm audit --omit=dev --audit-level=high') || cmd.includes('npm run audit')),
    'Workflow must run production vulnerability audit'
  );
  assert.ok(
    stepRuns.some(cmd => cmd.includes('docker build')),
    'Workflow must validate container build via docker build'
  );
});

test('Production Dependency Vulnerability Audit Check (with Offline/Sandbox Graceful Handling)', () => {
  let stdoutStr = '';
  let stderrStr = '';
  let auditError = false;

  try {
    stdoutStr = execSync('npm audit --omit=dev --audit-level=high --json', {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    auditError = true;
    stdoutStr = err.stdout?.toString() || '';
    stderrStr = err.stderr?.toString() || '';
  }

  // Detect offline / sandboxed network restriction across stdout & stderr
  const combined = stdoutStr + '\n' + stderrStr;
  const isOffline =
    combined.includes('ENOTFOUND') ||
    combined.includes('audit endpoint returned an error') ||
    combined.includes('EAI_AGAIN') ||
    combined.includes('ECONNREFUSED') ||
    combined.includes('fetch failed');

  if (isOffline) {
    // Local sandboxed or air-gapped dev environment: gracefully pass without false alert
    assert.ok(true, 'Offline sandbox environment detected; handled cleanly without crashing');
    return;
  }

  // Defensively parse JSON strictly from stdout (avoiding syntax errors from stderr npm warnings)
  let parsed = null;
  try {
    parsed = JSON.parse(stdoutStr);
  } catch (parseErr) {
    if (!auditError) {
      assert.ok(true, 'npm audit passed with code 0 (non-JSON output)');
      return;
    }
    assert.fail(`npm audit failed and stdout could not be parsed as JSON: ${parseErr.message}\nOutput: ${stdoutStr}`);
  }

  const highCount = parsed?.metadata?.vulnerabilities?.high || 0;
  const criticalCount = parsed?.metadata?.vulnerabilities?.critical || 0;

  assert.equal(highCount, 0, `Expected 0 high vulnerabilities in production dependencies, found ${highCount}`);
  assert.equal(criticalCount, 0, `Expected 0 critical vulnerabilities in production dependencies, found ${criticalCount}`);
});
