# Cal Bars generated public refresh

Public, narrowly scoped automation for refreshing Cal Golden Bars generated outputs from the live public Apps Script snapshot without consuming private-repository GitHub Actions minutes.

## Repository role

This repository is **not** the Cal Golden Bars application source and does not deploy application code. The private implementation source remains `calbearsquared2025/cal-bars-source`. The public deployment mirror remains `calbearsquared2025/cal-bars`.

The 12-hour workflow checks out the currently deployed public `cal-bars/main`, fetches and validates one live public Apps Script snapshot, regenerates the social outputs, refreshes `data/fallback-v2.json` when its public data changed, and rebuilds the generated venue routes plus venue sitemap entries from that same snapshot. Rebuilding the complete `locations/` tree removes retired venue routes instead of leaving stale pages behind. It ignores `generatedAt` when deciding whether the fallback needs replacement, validates that generated venue routes and sitemap entries exactly match the refreshed fallback, rechecks the public head for races, and pushes a non-force update only when generated outputs differ. Generated card filenames include a short content fingerprint so changed counts receive a new social-image URL instead of relying on third-party cache invalidation.

Permitted target changes are limited to:

- `assets/social-cards/*.png`
- `assets/social-cards/manifest.json`
- `share/<game>/index.html`
- the generated social metadata and loading-cover references inside `index.html`
- `data/fallback-v2.json`
- `locations/<venue-or-alias>/index.html`
- canonical venue entries in `sitemap.xml`

Any other change aborts the job. The fallback refresh is restricted to the known public snapshot fields and the configured `data/fallback-v2.json` path. Venue routes are rebuilt only from validated venue slugs and aliases, and validation fails if `locations/` or the sitemap does not exactly match the fallback. If the deployed social renderer version changes, automation also fails closed until this public renderer is deliberately updated; it must never silently roll a newer card design back.

## Schedule

`Refresh generated public outputs` runs every 12 hours at minute 17 and can also be run manually.

GitHub automatically disables scheduled workflows in inactive public repositories after 60 days. `Keep scheduled refresh active` therefore creates one empty repository commit on the 3rd of each month. That heartbeat has write access only to this automation repository and never receives the deploy key.

## Required SSH deploy key

The refresh publisher uses a **dedicated, write-enabled SSH deploy key** registered on `calbearsquared2025/cal-bars` (**Settings → Deploy keys**) as `CGB Social Refresh (SSH)`. Its matching private key is stored as the Actions repository secret `CGB_SOCIAL_REFRESH_SSH_KEY` on **`cal-bars-social-refresh`**, not `cal-bars` or `cal-bars-source`. This key must be distinct from the existing `CGB Public Deploy (SSH)` key, so each automation's access can be revoked independently.

The SSH private key is available **only in the conditional final push step**. The checkout remains anonymous HTTPS; snapshot retrieval, rendering, validation, and pull-request tests cannot access the credential. The push uses a pinned GitHub-published SSH host key, strict host verification, and a temporary key file removed on step exit. No personal access token or additional dependency is required.

**Cutover:** Verify a real `Refresh generated public outputs` run on `main` performs a successful **Push generated public update** step using the SSH key before deleting the old `CGB_PUBLIC_DEPLOY_TOKEN` secret and revoking the old personal access token. A successful run where the push step was skipped does **not** verify SSH write access. If a run generates no changes, leave the old credential in place until a later verified push. SSH deploy keys do not expire automatically but should be revoked and rotated if compromised.

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
