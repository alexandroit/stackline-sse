# Releasing

## Preconditions

- `main` is the only development branch.
- Version, changelog, documentation, and browser metadata agree.
- Runtime dependencies remain zero or an exception is documented.
- Local tests, GitHub CI, and CodeQL pass.
- npm and Verdaccio authentication are verified.

## Release gate

```bash
npm ci
npm test
npm run test:attw
npm run audit:dependencies
npm pack --dry-run
npm run benchmark
```

## Immutable artifact

Build and pack once. Publish the same bytes everywhere.

```bash
version="$(node -p "require('./package.json').version")"
mkdir -p "release/$version"
npm pack --ignore-scripts --pack-destination "release/$version"
(cd "release/$version" && sha512sum *.tgz > SHA512SUMS)
npm sbom --omit=dev --sbom-format cyclonedx > "release/$version/sbom.cdx.json"
```

Run `scripts/smoke-install.mjs` against the retained tarball.

## Registry sequence

1. Publish the retained tarball to Verdaccio.
2. Download it anonymously and compare SHA-512.
3. Smoke install directly and through both documented aliases.
4. Run `publish.yml` with the expected SHA-512. The trusted workflow rebuilds
   the reviewed commit and stops unless its tarball is byte-identical.
5. Let the workflow publish with npm provenance, then download anonymously and
   compare SHA-512 again.
6. Verify `latest`, registry signatures, audit output, and package visibility.

Do not rebuild between publications.

## GitHub and documentation

Tag the exact tested commit. Attach tarball, checksum, and CycloneDX SBOM to the
GitHub release. Deploy only the project documentation directory under
`/docs/vanilla/sse/`; do not delete unrelated documentation trees. Verify the
interactive site on desktop and mobile before announcing the release.

## Rollback

npm releases are immutable. Deprecate a defective version with a precise
message and publish a patch from the last known-good source. Unpublish only for
a compelling legal or security emergency.
