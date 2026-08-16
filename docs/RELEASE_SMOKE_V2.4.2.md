# v2.4.2 Release verification

v2.4.2 is a prospective licensing patch over the published GPL-3.0-only v2.4.1 security release. It does not claim new physical-device or scene coverage.

## Required before tagging

- explicit MIT consent for the migrated #69 Russian translation;
- `npm run typecheck`;
- `npm test -- --run`;
- `npm run build`;
- macOS, Windows, and Linux PR checks;
- CodeQL analysis with no open alert on the release revision;
- final archives contain `LICENSE.scrcpy-gui.txt`, `THIRD_PARTY_NOTICES.md`, and the platform-specific upstream scrcpy license file;
- packaged `scrcpy --version` and `adb version` checks remain successful;
- the Release workflow publishes a checksummed SPDX 2.3 SBOM and GitHub/Sigstore attestations for the release assets.

The physical-device, signing/notarization, manual installer, and Chocolatey Community gaps disclosed for v2.4.1 remain unchanged.

## Verified locally before the pull request

- `npm run typecheck`;
- `npm test -- --run`: 21 files / 185 tests;
- `npm run build`;
- `npm run icons:check`: 11 assets;
- unsigned macOS x64/arm64 packaging;
- the v2.4.2 arm64 final ZIP contains both project notices and the upstream runtime license;
- the same final ZIP executes packaged scrcpy 4.1 and ADB 1.0.41.

## Pull-request CI

[PR #190](https://github.com/SimonAKing/scrcpy-gui/pull/190) passed the latest merged-base [validation workflow](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31942153397) on macOS (35s), Ubuntu (22s), and Windows (51s). The Windows job also downloads the checksum-pinned official bundle, validates `LICENSE.txt`, and executes scrcpy 4.1 plus ADB 1.0.41.
