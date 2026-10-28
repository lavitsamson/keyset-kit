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

- **Actions > General > Actions permissions**: allow GitHub-owned actions plus
  `pnpm/action-setup@*` and `changesets/*`, and require actions to be pinned to a full-length
  commit SHA. A workflow that uses any other action fails at startup.
- **Actions > General > Workflow permissions**: keep the default read-only token and enable _Allow
  GitHub Actions to create and approve pull requests_.
- **Environments**: create `npm` (the first run creates it otherwise). Optionally add yourself as a
  required reviewer so each publish waits for approval.

npm package settings (**keyset-kit > Settings** on npmjs.com, needs 2FA). Do this before the next
release; without a trusted publisher the publish job has no way to authenticate:

1. **Trusted publishing**: add GitHub Actions with owner `lavitsamson`, repository `keyset-kit`,
   workflow `release.yml` and environment `npm`.
2. **Publishing access**: choose _Require two-factor authentication and disallow tokens_.

### First publish (1.0.0, done)

npm can't publish a package's first version through trusted publishing, so 1.0.0 was published on
2026-10-28 by the same workflow with a short-lived granular token that bypassed 2FA. The token was
revoked straight afterwards and the step that used it was removed from `release.yml`.

Don't repeat this for a new package. npm is deprecating 2FA-bypass tokens, and from around January
2027 they can't publish at all
([GitHub changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)).
Use staged publishing instead: CI stages the first version and a maintainer approves it on
npmjs.com with 2FA.

## Verifying a release

```sh
npm view keyset-kit version dist.attestations
npm audit signatures # in a project that installs keyset-kit
```

The package page on npmjs.com shows a _Provenance_ section linking to the commit and workflow run.
