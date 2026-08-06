# Changelog

All notable changes to gitcert are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While pre-1.0, minor versions may carry user-visible feature work and patch
versions carry fixes and polish.

## [Unreleased]

## [0.7.0] — 2026-08-06

### Added

- `GET /version` — reports the running deployment's commit, build timestamp,
  and Actions run, alongside a footer link back to that commit. Deployed
  from a public commit by GitHub Actions; not a cryptographic proof of
  anything.

### Changed

- Deploys now run from GitHub Actions on push to `main` instead of a
  maintainer running `wrangler deploy` locally.

### Removed

- References to the unbuilt shadcn registry in the docs and snippets.

## [0.6.4] — 2026-07-27

### Fixed

- Copy-button loading spinner no longer slides sideways — its rotation is now
  centered instead of orbiting the SVG viewBox corner.

### Documentation

- `/docs` now covers personal vs organization accounts: installing on an org,
  the per-account grouping (personal first, orgs marked with an `org` chip),
  team-shared control, and org-wide disconnect behavior.
- Added this changelog and pointed the docs "changelog ↗" link at it.

## [0.6.3] — 2026-07-27

### Fixed

- Every badge carrying a seal (all normal and stale badges) was unrenderable
  in READMEs and the dashboard preview: the seal's hover-draw hook was emitted
  as a valueless attribute, which is invalid in a badge SVG parsed as strict
  XML. It now carries an explicit value, and a guard test keeps badge output
  well-formed.

### Changed

- Copy buttons keep a static label — only the leading glyph animates through
  copy → loading → done. The stray "copied" text swap was removed.

## [0.6.2] — 2026-07-27

### Added

- A "JSON API" documentation section and a public API URL template for the
  signed `/api/:owner/:repo.json` endpoint, surfaced in the badge builder.

### Changed

- Pill badge metric glyphs updated: issues → wrench, open PRs → git-merge,
  created → calendar-days, size → box (status colors retained).
- Dashboard and shared surfaces polished: collapsible account groups,
  copy/sync/logo/verify motion, a responsive three-part footer, and the `api:`
  link row in the badge builder.

## [0.6.1] — 2026-07-25

### Fixed

- Per-repo sync now refreshes only the clicked repo instead of the whole
  account, and its icon spins on click and reflects the result.

### Removed

- The redundant global last-sync footer on the dashboard.

## [0.6.0] — 2026-07-25

### Added

- Organization installations on the dashboard — repos are grouped by
  installation account.

### Changed

- Aligned the Documentation nav link with the account menu and theme toggle.

## [0.5.1] — 2026-07-24

### Added

- Docs scrollspy active-nav highlighting and a back-to-dashboard link; aligned
  the badge reference table.

## [0.5.0] — 2026-07-24

### Added

- Public documentation page and an account menu with sign-out; moved
  "View on GitHub" into the footer.

## [0.4.1] — 2026-07-24

### Fixed

- Added the dashboard verify link and corrected the install-URL slug, the
  wordmark target, and the favicon.

## [0.4.0] — 2026-07-24

### Added

- Site footer, seal favicon, wordmark link, and dashboard polish.

### Changed

- Verify and API caches are purged on a repo toggle; shortened the not-found
  badge expiry.

## [0.3.0] — 2026-07-23

### Added

- Mobile-responsive layouts across all pages.

## [0.2.1] — 2026-07-23

### Fixed

- Badge clip-path collisions, a broken theme toggle, and incorrect accent usage.

## [0.2.0] — 2026-07-23

### Added

- Landing page, public README, and MIT license.

## [0.1.1] — 2026-07-23

### Fixed

- Accept GitHub's install-initiated OAuth callback without a state cookie.

## [0.1.0] — 2026-07-23

Initial release.

### Added

- Service core: Worker scaffold, D1 schema, collector, Ed25519 signing, and the
  GitHub webhook route.
- Public surfaces: SVG badges, the signed JSON API, the verify certificate page,
  and the edge cache layer.
- Owner dashboard with GitHub OAuth sessions and tenant-scoped repo management.
- Production Cloudflare and GitHub App configuration.

[Unreleased]: https://github.com/supergithubo/gitcert/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/supergithubo/gitcert/compare/v0.6.4...v0.7.0
[0.6.4]: https://github.com/supergithubo/gitcert/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/supergithubo/gitcert/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/supergithubo/gitcert/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/supergithubo/gitcert/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/supergithubo/gitcert/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/supergithubo/gitcert/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/supergithubo/gitcert/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/supergithubo/gitcert/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/supergithubo/gitcert/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/supergithubo/gitcert/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/supergithubo/gitcert/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/supergithubo/gitcert/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/supergithubo/gitcert/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/supergithubo/gitcert/releases/tag/v0.1.0
