import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('Litestream Configuration: litestream.yml is valid YAML and matches Tigris specs', () => {
  const configPath = path.join(ROOT_DIR, 'litestream.yml');
  assert.ok(fs.existsSync(configPath), 'litestream.yml must exist at root');

  const raw = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(raw);

  assert.ok(config, 'litestream.yml must parse into valid object');
  assert.ok(Array.isArray(config.dbs), 'litestream.yml must declare dbs array');
  assert.equal(config.dbs.length, 1, 'Currently configured with single primary database (telemetry.db)');

  const primaryDb = config.dbs[0];
  assert.equal(primaryDb.path, '/data/telemetry.db', 'Database path must be /data/telemetry.db');
  assert.ok(Array.isArray(primaryDb.replicas), 'Primary db must declare replicas array');
  assert.equal(primaryDb.replicas.length, 1, 'Primary db must declare exactly 1 S3 replica');

  const replica = primaryDb.replicas[0];
  assert.equal(replica.type, 's3', 'Replica type must be s3');
  assert.equal(replica.bucket, '${BUCKET_NAME}', 'Replica bucket must reference ${BUCKET_NAME}');
  assert.equal(replica.path, 'telemetry.db', 'Replica path must be telemetry.db');
  assert.ok(replica.endpoint.includes('fly.storage.tigris.dev'), 'Replica endpoint must target Fly Tigris');
  assert.equal(replica['force-path-style'], true, 'Replica must enforce path-style addressing');
  assert.equal(replica.retention, '168h', 'Replica must retain 7-day point-in-time recovery window');

  // [RULE-CONF-01] Declarative Configuration Syntax Hygiene:
  // Go os.ExpandEnv used by Litestream does NOT support POSIX ${VAR:-default} expansion.
  assert.ok(
    !raw.includes(':-'),
    'litestream.yml must not use POSIX ${VAR:-default} parameter expansion (unsupported by Go os.ExpandEnv)'
  );
});

test('Docker Entrypoint: scripts/docker-entrypoint.sh exists, is executable, and contains safeguards', () => {
  const scriptPath = path.join(ROOT_DIR, 'scripts/docker-entrypoint.sh');
  assert.ok(fs.existsSync(scriptPath), 'docker-entrypoint.sh must exist');

  // Verify executable bit
  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
  } catch {
    assert.fail('scripts/docker-entrypoint.sh must have executable permissions (chmod +x)');
  }

  const content = fs.readFileSync(scriptPath, 'utf8');

  // Safeguard 1: Standalone fallback if credentials missing
  assert.ok(
    content.includes('AWS_ACCESS_KEY_ID') && content.includes('BUCKET_NAME'),
    'Entrypoint must inspect AWS_ACCESS_KEY_ID and BUCKET_NAME'
  );
  assert.ok(content.includes('exec "$@"'), 'Entrypoint must pass through to CMD in standalone mode');

  // Safeguard 2: Double guard against overwriting existing local database
  assert.ok(
    content.includes('if [ ! -f "$TARGET_DB" ]; then') || content.includes('if [ ! -f /data/telemetry.db ]; then'),
    'Entrypoint must check file existence before calling restore'
  );
  assert.ok(
    content.includes('-if-db-not-exists'),
    'Entrypoint must pass -if-db-not-exists to litestream restore'
  );
  assert.ok(
    content.includes('-if-replica-exists'),
    'Entrypoint must pass -if-replica-exists to litestream restore'
  );

  // Safeguard 3: Supervised execution with signal forwarding
  assert.ok(
    content.includes('exec litestream replicate -config /etc/litestream.yml -exec "$*"'),
    'Entrypoint must use exec litestream replicate -exec to supervise Node.js and forward signals'
  );
});

test('Docker Entrypoint: executes standalone fallback cleanly when credentials absent', () => {
  const scriptPath = path.join(ROOT_DIR, 'scripts/docker-entrypoint.sh');
  const tmpDir = fs.mkdtempSync('/tmp/flood-entrypoint-ok-');
  try {
    const result = execSync(`${scriptPath} echo "STANDALONE_SUCCESS"`, {
      env: { PATH: process.env.PATH, DB_PATH: path.join(tmpDir, 'telemetry.db') },
      encoding: 'utf8'
    });

    assert.ok(result.includes('Starting Node.js in standalone local mode'), 'Entrypoint logs standalone mode');
    assert.ok(result.includes('STANDALONE_SUCCESS'), 'Child process executed cleanly');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Docker Entrypoint ([RULE-INFRA-01]): fails fast when volume directory or DB file is read-only', () => {
  const scriptPath = path.join(ROOT_DIR, 'scripts/docker-entrypoint.sh');
  // Skip if running tests as root (root bypasses 0555 directory permissions)
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return;
  }

  // Case 1: Read-only volume directory (simulating root-shadowed /data mount)
  const roDir = fs.mkdtempSync('/tmp/flood-ro-dir-');
  fs.chmodSync(roDir, 0o555);
  try {
    assert.throws(
      () => {
        execSync(`${scriptPath} echo "SHOULD_NOT_RUN"`, {
          env: { PATH: process.env.PATH, DB_PATH: path.join(roDir, 'telemetry.db') },
          encoding: 'utf8',
          stdio: 'pipe'
        });
      },
      (err) => {
        assert.ok(err.stderr.includes('FATAL: Volume directory'), 'Must emit FATAL volume directory diagnostic');
        return true;
      }
    );
  } finally {
    fs.chmodSync(roDir, 0o755);
    fs.rmSync(roDir, { recursive: true, force: true });
  }

  // Case 2: Writeable directory, but read-only existing database file
  const rwDir = fs.mkdtempSync('/tmp/flood-ro-file-');
  const roDbFile = path.join(rwDir, 'telemetry.db');
  fs.writeFileSync(roDbFile, '');
  fs.chmodSync(roDbFile, 0o444);
  try {
    assert.throws(
      () => {
        execSync(`${scriptPath} echo "SHOULD_NOT_RUN"`, {
          env: { PATH: process.env.PATH, DB_PATH: roDbFile },
          encoding: 'utf8',
          stdio: 'pipe'
        });
      },
      (err) => {
        assert.ok(err.stderr.includes('FATAL: Existing database file'), 'Must emit FATAL database file diagnostic');
        return true;
      }
    );
  } finally {
    fs.chmodSync(roDbFile, 0o644);
    fs.rmSync(rwDir, { recursive: true, force: true });
  }

  // Case 3: Writeable DB file, but read-only WAL journal file (root-shadowed WAL)
  const walDir = fs.mkdtempSync('/tmp/flood-ro-wal-');
  const rwDbFile = path.join(walDir, 'telemetry.db');
  const roWalFile = path.join(walDir, 'telemetry.db-wal');
  fs.writeFileSync(rwDbFile, '');
  fs.writeFileSync(roWalFile, '');
  fs.chmodSync(roWalFile, 0o444);
  try {
    assert.throws(
      () => {
        execSync(`${scriptPath} echo "SHOULD_NOT_RUN"`, {
          env: { PATH: process.env.PATH, DB_PATH: rwDbFile },
          encoding: 'utf8',
          stdio: 'pipe'
        });
      },
      (err) => {
        assert.ok(err.stderr.includes('FATAL: Existing database file'), 'Must emit FATAL database file diagnostic for WAL');
        assert.ok(err.stderr.includes('telemetry.db-wal'), 'Diagnostic must pinpoint the unwriteable WAL journal');
        return true;
      }
    );
  } finally {
    fs.chmodSync(roWalFile, 0o644);
    fs.rmSync(walDir, { recursive: true, force: true });
  }
});

test('Cloud Resource Isolation ([RULE-SEC-02]): zero hardcoded bucket names or Tigris secrets in repository files', () => {
  const filesToScan = [
    'fly.toml',
    'litestream.yml',
    'Dockerfile',
    'package.json',
    'server.js',
    'scripts/docker-entrypoint.sh',
    'docs/ARCHITECTURAL_PRINCIPLES.md',
    '.agents/AGENTS.md'
  ];

  const forbiddenPatterns = [
    { pattern: /flood-telemetry-backup-[a-z0-9]+/i, reason: 'Hardcoded Tigris bucket identifier' },
    { pattern: /tid_[A-Za-z0-9]{10,}/, reason: 'Tigris Access Key ID leak' },
    { pattern: /tsec_[A-Za-z0-9]{10,}/, reason: 'Tigris Secret Access Key leak' }
  ];

  for (const relPath of filesToScan) {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const { pattern, reason } of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `[RULE-SEC-02] Violation in ${relPath}: detected ${reason}`
      );
    }
  }
});

test('Deployment Invariant: fly.toml enforces immediate deployment strategy and Tigris env vars', () => {
  const flyTomlPath = path.join(ROOT_DIR, 'fly.toml');
  assert.ok(fs.existsSync(flyTomlPath), 'fly.toml must exist');

  const content = fs.readFileSync(flyTomlPath, 'utf8');

  // Single-writer requirement to prevent Litestream split-brain replica divergence
  assert.ok(
    content.includes("strategy = 'immediate'"),
    "fly.toml must specify strategy = 'immediate' to prevent concurrent rolling writers"
  );
  // Invariant: BUCKET_NAME must NOT be hardcoded in public fly.toml to prevent bucket name enumeration.
  // It is injected dynamically at deployment time via encrypted Fly secrets (fly storage link).
  assert.ok(
    !content.includes('BUCKET_NAME ='),
    'fly.toml must not leak BUCKET_NAME in public git; must rely on encrypted Fly secret injection'
  );
  assert.ok(
    content.includes("LITESTREAM_ENDPOINT = 'https://fly.storage.tigris.dev'"),
    'fly.toml must specify LITESTREAM_ENDPOINT in env'
  );
});

test('Server Runtime: exports gracefulShutdown and handles /api/health database liveness check', async () => {
  const serverModule = await import('../server.js');
  assert.ok(
    typeof serverModule.gracefulShutdown === 'function',
    'server.js must export gracefulShutdown function'
  );

  // Test /api/health response on active server using ephemeral port
  await new Promise((resolve, reject) => {
    serverModule.server.listen(0, () => {
      const port = serverModule.server.address().port;
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        assert.equal(res.statusCode, 200);
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const json = JSON.parse(body);
          assert.equal(json.status, 'ok');
          assert.ok(typeof json.uptime === 'number');
          assert.ok(json.database, 'Must include database status');
          assert.equal(json.database.connected, true);
          assert.equal(json.database.journal_mode, 'wal');
          assert.ok(json.replication, 'Must include replication status');
          serverModule.server.close(resolve);
        });
      });
      req.on('error', (err) => {
        serverModule.server.close(() => reject(err));
      });
    });
  });
});
