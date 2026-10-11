# Releasing

Releases are published from GitHub Actions by `.github/workflows/release.yml`. See
[ADR 0005](adr/0005-release-pipeline.md) for the reasoning.

## Day to day

1. Add a changeset to any PR that changes the public API: `pnpm changeset`.
2. After it is merged and CI passes, the release workflow opens or updates the
   **chore: version packages** PR with the version bump and `CHANGELOG.md` entry.
3. Merge that PR when you want to release. When CI passes on `main`, the workflow publishes to npm
   with provenance, pushes the `vX.Y.Z` tag and creates the GitHub release.

## One-time setup

GitHub repository settings:

- **Actions > General > Workflow permissions**: enable _Allow GitHub Actions to create and approve
  pull requests_.
- **Environments**: create `npm` (the first run creates it otherwise). Optionally add yourself as a
  required reviewer so each publish waits for approval.

### First publish (1.0.0)

npm can't publish a package's first version through trusted publishing, so 1.0.0 uses a token:

1. On npmjs.com, create a **granular access token**: read and write for all packages (the package
   doesn't exist yet), shortest expiry, _Bypass two-factor authentication_ checked.
2. Add it as the `NPM_TOKEN` secret of the `npm` environment (Settings > Environments > npm).
3. Merge the Version Packages PR. The publish job uses the token and still attaches provenance.

### After the first publish

1. On npmjs.com, open **keyset-kit > Settings > Trusted publishing** and add GitHub Actions:
   owner `lavitsamson`, repository `keyset-kit`, workflow `release.yml`, environment `npm`.
2. Under **Publishing access**, choose _Require two-factor authentication and disallow tokens_.
3. Delete the `NPM_TOKEN` secret and revoke the token on npmjs.com.

## Verifying a release

```sh
npm view keyset-kit version dist.attestations
npm audit signatures # in a project that installs keyset-kit
```

The package page on npmjs.com shows a _Provenance_ section linking to the commit and workflow run.
