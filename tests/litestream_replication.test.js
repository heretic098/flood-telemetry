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
  const result = execSync(`${scriptPath} echo "STANDALONE_SUCCESS"`, {
    env: { PATH: process.env.PATH },
    encoding: 'utf8'
  });

  assert.ok(result.includes('Starting Node.js in standalone local mode'), 'Entrypoint logs standalone mode');
  assert.ok(result.includes('STANDALONE_SUCCESS'), 'Child process executed cleanly');
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
