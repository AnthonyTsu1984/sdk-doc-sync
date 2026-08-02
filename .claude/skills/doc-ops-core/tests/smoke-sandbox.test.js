'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const sandboxRoot = path.join(repoRoot, '.claude', 'skills', 'doc-ops-core', 'sandbox');

function read(relative) {
  return fs.readFileSync(path.join(sandboxRoot, relative), 'utf8');
}

test('compose isolates lark configuration in named volumes with a hardened container', () => {
  const compose = read('compose.yaml');
  assert.match(compose, /doc_ops_smoke_lark_config:/);
  assert.match(compose, /doc_ops_smoke_lark_keychain:/);
  assert.match(compose, /doc_ops_smoke_state:/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.doesNotMatch(compose, /~\/\.lark-cli|\/Users\/|docker\.sock|env_file:/);
  assert.match(compose, /\/home\/smoke\/\.lark-cli/);
  assert.match(compose, /doc_ops_smoke_lark_keychain:\/home\/smoke\/\.local\/share\/lark-cli/);
});

test('Docker image pins lark-cli and runs as an unprivileged user', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /apt-get install[^\n]+ca-certificates[^\n]+curl/);
  assert.match(dockerfile, /ARG LARK_CLI_VERSION=1\.0\.65/);
  assert.match(dockerfile, /@larksuite\/cli@\$\{LARK_CLI_VERSION\}/);
  assert.match(dockerfile, /useradd[^\n]+smoke/);
  assert.match(dockerfile, /USER smoke/);
  assert.match(dockerfile, /ENV HOME=\/home\/smoke/);
});

test('profile initialization reads the secret silently and passes it only through stdin', () => {
  const entrypoint = read('entrypoint.sh');
  assert.match(entrypoint, /read -r -s DOC_OPS_APP_SECRET/);
  assert.match(entrypoint, /--app-secret-stdin/);
  assert.match(entrypoint, /--name doc-ops-smoke/);
  assert.match(entrypoint, /unset DOC_OPS_APP_ID DOC_OPS_APP_SECRET/);
  assert.doesNotMatch(entrypoint, /--app-secret(?:\s|=)/);
});

test('every post-initialization lark command forces the isolated profile', () => {
  const entrypoint = read('entrypoint.sh');
  assert.match(entrypoint, /exec lark-cli --profile "\$PROFILE_NAME" "\$@"/);
});

test('generic lark passthrough prepends the profile before root flags', () => {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-lark-probe-'));
  const fakeCli = path.join(probeRoot, 'lark-cli');
  try {
    fs.writeFileSync(fakeCli, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\n');
    fs.chmodSync(fakeCli, 0o755);
    const result = spawnSync(path.join(sandboxRoot, 'entrypoint.sh'), ['lark', '--version'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${probeRoot}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), ['--profile', 'doc-ops-smoke', '--version']);
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('QR generation changes to the state volume and gives lark-cli a relative output path', () => {
  const entrypoint = read('entrypoint.sh');
  assert.match(entrypoint, /cd \/state/);
  assert.match(entrypoint, /auth qrcode "\$1" --output auth-qr\.png/);
  assert.doesNotMatch(entrypoint, /--output \/state\//);
});

test('sandbox does not expose a shell escape hatch', () => {
  const entrypoint = read('entrypoint.sh');
  const wrapper = read('sandbox.sh');
  assert.doesNotMatch(entrypoint, /^\s*shell\)/m);
  assert.doesNotMatch(wrapper, /^\s*shell\)/m);
  assert.doesNotMatch(entrypoint, /^\s*shell\s+Open/m);
  assert.doesNotMatch(wrapper, /^\s*shell\s+Open/m);
});

test('host wrapper uses an explicit compose project and makes volume reset opt-in', () => {
  const wrapper = read('sandbox.sh');
  assert.match(wrapper, /COMPOSE_PROJECT_NAME=doc-ops-smoke/);
  assert.match(wrapper, /DOC_OPS_SMOKE_CONFIRM_RESET/);
  assert.match(wrapper, /init-profile/);
  assert.match(wrapper, /auth-login/);
  assert.match(wrapper, /auth-complete/);
  assert.match(wrapper, /status/);
  assert.match(wrapper, /lark\)\s+compose run --rm --no-deps -T lark-cli lark "\$@"/);
  assert.doesNotMatch(wrapper, /\.lark-cli:\/home\/smoke\/\.lark-cli/);
});

test('operator commands keep all test-tenant lark usage inside the sandbox', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const guide = fs.readFileSync(
    path.join(repoRoot, '.claude', 'skills', 'doc-ops-core', 'references', 'tenant-smoke-environment.md'),
    'utf8',
  );
  assert.equal(
    packageJson.scripts['smoke:sandbox:auth-complete'],
    'bash .claude/skills/doc-ops-core/sandbox/sandbox.sh auth-complete',
  );
  assert.equal(
    packageJson.scripts['smoke:sandbox:qrcode'],
    'bash .claude/skills/doc-ops-core/sandbox/sandbox.sh qrcode',
  );
  assert.equal(
    packageJson.scripts['smoke:sandbox:lark'],
    'bash .claude/skills/doc-ops-core/sandbox/sandbox.sh lark',
  );
  assert.doesNotMatch(guide, /^lark-cli\s/m);
  assert.match(guide, /npm run smoke:sandbox:auth-complete --/);
  assert.match(guide, /npm run smoke:sandbox:lark -- drive \+create-folder/);
  assert.match(guide, /npm run smoke:sandbox:lark -- base \+base-create/);
});

test('docker build context excludes local credentials and runtime state', () => {
  const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
  for (const required of ['.env', '.env.*', '.lark-cli', 'tmp/', '.git/', '.worktrees/']) {
    assert.match(dockerignore, new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(dockerignore, /^!\.env\.smoke\.example$/m);
});
