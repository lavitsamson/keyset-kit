# ADR 0005: Release pipeline

- Status: Accepted
- Date: 2026-10-11

## Context

`keyset-kit` is published to npm from GitHub Actions. Every release should be reproducible from a
commit that passed CI, carry a provenance attestation that links the tarball to that commit and
workflow, and need no long-lived secret. Release notes come from changesets written alongside
each change.

## Decisions

### Changesets, with a "Version Packages" PR

Each public API change adds a changeset. On `main`, the release workflow turns pending changesets
into a pull request that bumps `package.json` and writes `CHANGELOG.md`. Merging that PR is the
decision to release. The next run publishes the new version, tags it and creates a GitHub release
whose body is the changelog entry.

Changesets written before 1.0.0 described changes between unpublished states ("previously failed
with `SORT_MISMATCH`"). Nobody installed those states, so they were folded into one `major`
changeset with release notes for 1.0.0.

### Release only after CI passes

The workflow is triggered by `workflow_run` on a successful CI run for a push to `main`, and
checks out that run's exact commit. A red build can't open a release PR or publish. One side
effect: PRs opened with the built-in `GITHUB_TOKEN` don't trigger other workflows, so the Version
Packages PR shows no CI checks. It only changes the version and changelog, and merging it runs CI
on `main` before anything is published.

### Trusted publishing, split into least-privilege jobs

npm trusted publishing exchanges a GitHub OIDC token for a one-time publish credential, so no npm
token is stored. npm attaches provenance automatically, and `provenance: true` in
`pnpm-workspace.yaml` makes it mandatory, so a token-based publish (or a laptop) can't ship an
unattested version.

The workflow uses the Changesets sub-actions, one job per concern:

| Job           | Permissions                        | Does                                         |
| ------------- | ---------------------------------- | -------------------------------------------- |
| `select-mode` | `contents: read`                   | Decides: version, publish or nothing         |
| `version`     | `contents`, `pull-requests`: write | Opens or updates the Version Packages PR     |
| `pack`        | `contents: read`                   | Builds, runs publint/attw/size, packs        |
| `publish`     | `contents`, `id-token`: write      | Publishes the packed tarball, tags, releases |

The build runs in a job that can't publish, and the publishing job runs no build. Release jobs
skip the dependency cache so a poisoned cache can't reach a publish. The `publish` job runs in the
`npm` environment, so required reviewers can be added, and the trusted publisher can be bound to
that environment.

### Bootstrap token for the first version

npm can't publish a package's first version through trusted publishing (npm/cli#8544). The
alternative, a placeholder version published by hand, would leave an unattested version in the
registry forever. Instead, 1.0.0 is published by the same workflow with a short-lived granular
token in the `npm` environment's `NPM_TOKEN` secret, still with provenance. Afterwards the trusted
publisher is configured, the secret deleted and token publishing disallowed on the package.

1.0.0 was published this way on 2026-10-28. The token was then revoked and the bootstrap step
removed from `release.yml`, so the workflow can only publish through OIDC.

This route won't be available for future packages. npm is deprecating granular tokens that bypass
2FA: from August 2026 they can't manage packages, and from around January 2027 they can't publish
([GitHub changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)).
The replacement for a new package is staged publishing, where CI stages the first version and a
maintainer approves it with 2FA. A new package should start with that instead of a bypass token.

## Consequences

- Releasing is reviewing and merging a PR. No one publishes from a machine.
- Every published version links to the commit and workflow run that built it.
- The publish path is only tested by a real release; `docs/RELEASING.md` lists the one-time setup
  and how to verify a release.
- The npm trusted publisher names `release.yml`. Renaming the file breaks publishing until the
  configuration is updated.
