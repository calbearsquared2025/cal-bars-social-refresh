import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/refresh-social-graphics.yml', import.meta.url), 'utf8');
const pushStepMarker = '      - name: Push generated public update\n';
const pushStepIndex = workflow.indexOf(pushStepMarker);
const beforePush = workflow.slice(0, pushStepIndex);
const pushStep = workflow.slice(pushStepIndex);

test('social-refresh publisher uses a dedicated SSH key only when a validated change is ready to push', () => {
  assert.notEqual(pushStepIndex, -1, 'conditional push step must be present');
  assert.match(pushStep, /if: steps\.commit\.outputs\.changed == 'true'/);
  assert.match(pushStep, /secrets\.CGB_SOCIAL_REFRESH_SSH_KEY/);
  assert.doesNotMatch(beforePush, /CGB_SOCIAL_REFRESH_SSH_KEY/, 'earlier checkout, refresh and tests must not receive the private key');
  assert.doesNotMatch(workflow, /CGB_PUBLIC_DEPLOY_TOKEN|x-access-token:/, 'the workflow must not depend on a personal access token');
  assert.match(workflow, /git clone --depth=1 https:\/\/github\.com\/calbearsquared2025\/cal-bars\.git \.target/, 'public data checkout must stay anonymous');
});

test('SSH push uses an ephemeral private key, verified GitHub host, and the restricted public target', () => {
  assert.match(pushStep, /if \[ -z "\$SOCIAL_REFRESH_SSH_KEY" \]/, 'missing deploy key must fail closed');
  assert.match(pushStep, /umask 077/);
  assert.match(pushStep, /trap 'rm -rf "\$ssh_dir"' EXIT/, 'temporary private key must be cleaned up');
  assert.match(pushStep, /github\.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl/, 'host trust must use GitHub published key');
  assert.match(pushStep, /StrictHostKeyChecking=yes/);
  assert.match(pushStep, /BatchMode=yes/);
  assert.match(pushStep, /git -C \.target push git@github\.com:calbearsquared2025\/cal-bars\.git HEAD:main/, 'push may target only the public deployment main branch');
});

test('public-head race check and narrowly scoped generated changes remain intact', () => {
  assert.match(workflow, /if \[ "\$actual_public_head" != "\$EXPECTED_PUBLIC_HEAD" \]/);
  assert.match(workflow, /node scripts\/validate-public-diff\.mjs \.target/);
  assert.match(workflow, /git -C \.target add index\.html sitemap\.xml locations assets\/social-cards share data\/fallback-v2\.json/);
  assert.match(workflow, /git -C \.target diff --cached --quiet/);
});
