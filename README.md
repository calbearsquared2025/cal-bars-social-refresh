# Cal Bars generated public refresh

Public, narrowly scoped automation for refreshing Cal Golden Bars social-card graphics and the deployed public fallback snapshot from the live public Apps Script snapshot without consuming private-repository GitHub Actions minutes.

## Repository role

This repository is **not** the Cal Golden Bars application source and does not deploy application code. The private implementation source remains `calbearsquared2025/cal-bars-source`. The public deployment mirror remains `calbearsquared2025/cal-bars`.

The 12-hour workflow checks out the currently deployed public `cal-bars/main`, fetches and validates one live public Apps Script snapshot, regenerates the social outputs, and refreshes `data/fallback-v2.json` from that same snapshot when its public data changed. It ignores `generatedAt` when deciding whether the fallback needs replacement, validates that no other public file changed, rechecks the public head for races, and pushes a non-force update only when generated outputs differ. Generated card filenames include a short content fingerprint so changed counts receive a new social-image URL instead of relying on third-party cache invalidation.

Permitted target changes are limited to:

- `assets/social-cards/*.png`
- `assets/social-cards/manifest.json`
- `share/<game>/index.html`
- the generated social metadata and loading-cover references inside `index.html`
- `data/fallback-v2.json`

Any other change aborts the job. The fallback refresh is restricted to the known public snapshot fields and the configured `data/fallback-v2.json` path. If the deployed social renderer version changes, automation also fails closed until this public renderer is deliberately updated; it must never silently roll a newer card design back.

## Schedule

`Refresh generated public outputs` runs every 12 hours at minute 17 and can also be run manually.

GitHub automatically disables scheduled workflows in inactive public repositories after 60 days. `Keep scheduled refresh active` therefore creates one empty repository commit on the 3rd of each month. That heartbeat has write access only to this automation repository and never receives the deployment PAT.

## Required secret

Repository secret `CGB_PUBLIC_DEPLOY_TOKEN`: a fine-grained GitHub PAT scoped only to `calbearsquared2025/cal-bars` with **Contents: Read and write**. No Workflows permission is needed.

The deployment secret is provided only to the final push step. Public checkout, snapshot retrieval, rendering, validation, and concurrency checks do not receive it. Pull-request tests never receive it.

## Local checks

```bash
npm run check:syntax
npm test
```

To exercise the generator against a local checkout of the public deployment:

```bash
node scripts/refresh-social-graphics.mjs /path/to/cal-bars
node scripts/validate-public-diff.mjs /path/to/cal-bars
```
