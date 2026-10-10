# Changesets

Any change to the public API needs a changeset. Run `pnpm changeset`, pick the bump type, and
describe the change for the changelog. The release workflow turns changesets into a
"Version Packages" PR; merging that PR publishes to npm with provenance.
