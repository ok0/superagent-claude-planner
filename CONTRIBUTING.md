# Contributing to issuecrew-planner

Thanks for helping improve issuecrew-planner. This guide covers setup, the checks, commit rules, and how releases work.

## Development setup

- Node.js 22.19 or newer (the release workflow uses Node.js 24).
- pnpm 11. The exact version is the `packageManager` field in `package.json`, for example `npm install --global pnpm@11.28.11`.

```sh
git clone https://github.com/<owner>/issuecrew-planner.git
cd issuecrew-planner
pnpm install --frozen-lockfile
pnpm build
```

`<owner>` is the GitHub owner of the repository you cloned or forked. To load the plugin from a local checkout, see [Plugin install](docs/setup.md#plugin-install). `fixtures/synthetic-shop/` contains three small placeholder repositories, a sample catalog, and sample configs, so you can try the Skill without real repositories.

## Tests

`pnpm test` runs the offline suite with Vitest. It needs no network and no GitHub token: GitHub calls go to a fake host or a local stub. Every change must pass it.

## Checks

`pnpm check` runs typecheck, format check, tests, build, bundle check, hygiene check, and commit-message check. It stops at the first failure and exits non-zero. Run it before every pull request.

Run `pnpm format` to format the TypeScript sources with Prettier. `pnpm format:check` only checks them.

`pnpm release:check` builds, checks the npm pack contents, and installs the tarball in a clean temporary project. It is not part of `pnpm check`; run it when you change packaging.

### Forbidden names

The hygiene check (`pnpm hygiene`, part of `pnpm check`) and the pack check scan the repository for names that must never appear in it, such as personal accounts, organizations, or practice repositories. The list is never committed. Put one name per line in a local `.forbidden-names` file at the repository root (it is gitignored; lines starting with `#` are comments), or set `ISSUECREW_PLANNER_FORBIDDEN_NAMES` to a comma-separated list. Without either, the name scan is skipped with a notice. The committed `.hygiene-allow` file lists exact substrings that the scan exempts, one per line, such as this project's own repository URLs; an entry matches only when it is not followed by a letter, digit, `-` or `_`.

## Commit messages

Use Conventional Commits: `type(scope)?: subject`. Allowed types are feat, fix, docs, style, refactor, perf, test, build, ci, chore and revert. Keep the subject at 100 characters or less.

Do not put internal planning IDs (such as milestone numbers) in commit messages. No AI attribution: do not add AI co-author trailers, "generated with" lines, or other AI attribution to commit messages, pull requests, or code.

`pnpm check:commits` checks every commit reachable from HEAD against these rules, and `pnpm check` runs it.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Update the tests and docs that the change affects.
3. Run `pnpm check` and make sure it passes.
4. Open the pull request.

## Releases

Maintainers release by pushing a version tag `vX.Y.Z` that equals the `version` in `package.json`. The tag push runs the release workflow, which runs `pnpm check` and `pnpm release:check` and publishes to npm with Trusted Publishing (OIDC, with provenance), so no npm token is stored. The full procedure, including the manual gate and the post-publish checks, is in [docs/release.md](docs/release.md).
