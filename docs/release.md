# Release guide

This guide is for maintainers. Tokens are never printed, logged, pasted in issues, or committed. `npm login` is always run by the maintainer.

## Versions

Releases use semver. The git tag `vX.Y.Z` must equal the `version` in `package.json`.

## One-time setup

- An npm account with 2FA enabled.
- A CI credential, one of:
  - An npm trusted publisher for the workflow `release.yml`. Configure it on the npm package page after the first publish. This is preferred because no token is stored.
  - A repository secret `NPM_TOKEN` holding a granular npm token with publish rights for this package only.

## Prepare the release

1. Bump `version` in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (`plugins[0].version`).
2. Commit with the message `chore(release): X.Y.Z`.
3. Provide the forbidden names locally, either in `.forbidden-names` or in the `ISSUECREW_PLANNER_FORBIDDEN_NAMES` environment variable, so the name scan runs.

The fields `repository`, `homepage`, and `bugs` in `package.json`, and the exact substrings listed in `.hygiene-allow`, are the only exemptions in the name scan. All other text is scanned.

## Check

1. `pnpm check`
2. `pnpm release:check`. This builds, runs `check:pack` (file list, deny rules, name and token scan), runs `smoke:pack` (clean install of the tarball, `--help`, `validate`, import), and is the same set the workflow runs.
3. `npm publish --dry-run`. Review the version and the file list.

## Manual gate

The maintainer runs `npm login`.

Check that the version is not yet published with `npm view issuecrew-planner version`. On the first release this returns E404, which is expected.

Show the version and the `npm publish --dry-run` file list, and get explicit confirmation. Then run `npm publish --access public`. Publishing is never automatic.

## Tag and push

1. `git push origin main`
2. `git tag vX.Y.Z && git push origin vX.Y.Z`

The workflow runs on a tag push or on `workflow_dispatch` with the input `tag`. It verifies that the tag equals the package version, runs `pnpm check` and `pnpm release:check`, and skips publishing if that version is already on npm.

## After publishing

- `npm view issuecrew-planner version`
- `cd "$(mktemp -d)" && npx --yes issuecrew-planner --help`

## Recovery

Never reuse a published version. Fix the problem, bump the patch version, and repeat the release. For a bad version, use `npm deprecate` on that version.
