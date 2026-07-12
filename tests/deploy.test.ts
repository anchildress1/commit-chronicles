import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SERVICE_URL = 'https://commit-chronicles.example.run.app';

async function runDeploy(existing: boolean): Promise<string[]> {
  const bin = await mkdtemp(join(tmpdir(), 'commit-chronicles-deploy-'));
  const log = join(bin, 'gcloud.log');
  const deployed = join(bin, 'deployed');
  const gcloud = join(bin, 'gcloud');

  await writeFile(
    gcloud,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GCLOUD_LOG"
if [[ "$*" == "run services describe"* ]]; then
  if [[ "${existing ? 'yes' : 'no'}" == "yes" || -f "$DEPLOYED_MARKER" ]]; then
    printf '%s\n' "$SERVICE_URL"
  else
    exit 1
  fi
elif [[ "$*" == "run deploy"* ]]; then
  touch "$DEPLOYED_MARKER"
fi
`,
  );
  await chmod(gcloud, 0o755);

  await exec('bash', ['deploy.sh'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      GCLOUD_LOG: log,
      DEPLOYED_MARKER: deployed,
      SERVICE_URL,
      SNOWFLAKE_ACCOUNT: 'test-account',
      SNOWFLAKE_USER: 'test-user',
    },
  });

  return (await readFile(log, 'utf8')).trim().split('\n');
}

describe('deploy.sh', () => {
  it('keeps a new service private until its queue configuration exists', async () => {
    const calls = await runDeploy(false);

    const privateDeploy = calls.findIndex(
      (call) => call.includes('run deploy') && call.includes('--no-allow-unauthenticated'),
    );
    const queueUpdate = calls.findIndex(
      (call) => call.includes('run services update') && call.includes(`WORKER_URL=${SERVICE_URL}`),
    );
    const publicIam = calls.findIndex(
      (call) =>
        call.includes('run services add-iam-policy-binding') && call.includes('--member=allUsers'),
    );

    expect(privateDeploy).toBeGreaterThanOrEqual(0);
    expect(queueUpdate).toBeGreaterThan(privateDeploy);
    expect(publicIam).toBeGreaterThan(queueUpdate);
  });

  it('deploys an existing queued service publicly without bootstrap mutations', async () => {
    const calls = await runDeploy(true);

    expect(
      calls.some((call) => call.includes('run deploy') && call.includes('--allow-unauthenticated')),
    ).toBe(true);
    expect(calls.some((call) => call.includes(`WORKER_URL=${SERVICE_URL}`))).toBe(true);
    expect(calls.some((call) => call.includes('run services update'))).toBe(false);
    expect(calls.some((call) => call.includes('run services add-iam-policy-binding'))).toBe(false);
  });
});
