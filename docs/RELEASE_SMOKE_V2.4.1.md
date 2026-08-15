# v2.4.1 Release verification

v2.4.1 is a licensing-only patch over v2.4.0. It does not claim new device or hardware coverage.

## Required before tagging

- explicit MIT consent for the migrated #69 Russian translation;
- `npm run typecheck`;
- `npm test -- --run`;
- `npm run build`;
- macOS, Windows, and Linux PR checks;
- final archives contain `LICENSE.scrcpy-gui.txt`, `THIRD_PARTY_NOTICES.md`, and the upstream `scrcpy/LICENSE`;
- packaged `scrcpy --version` and `adb version` checks remain successful.

The physical-device, signing/notarization, manual installer, and Chocolatey Community gaps disclosed for v2.4.0 remain unchanged.

## Verified locally before the pull request

- `npm run typecheck`;
- `npm test -- --run`: 19 files / 174 tests;
- `npm run build`;
- `npm run icons:check`: 11 assets;
- unsigned macOS x64/arm64 packaging;
- the v2.4.1 arm64 final ZIP contains both project notices and the upstream runtime license;
- the same final ZIP executes packaged scrcpy 4.1 and ADB 1.0.41.
