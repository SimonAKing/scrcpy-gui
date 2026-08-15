# v2.4.0 Release verification

This record separates evidence collected before the tag from checks that run only on the tag workflow. A missing item is not inferred as passing.

## Verified before tagging

- `npm run typecheck`
- `npm test -- --run`: 19 test files, 174 tests
- `npm run build`
- GitHub Validate matrix on PR #187: Ubuntu, macOS, and Windows passed
- Electron/Chromium layout checks at 880×640, 1120×780, 1440×900, and device scale factor 2
- No page-level horizontal overflow or off-screen form controls in the checked views; the preflight table owns its horizontal scrolling
- locally built `Scrcpy.GUI-2.4.0-mac-arm64.zip` was extracted by `npm run smoke:packaged-runtime`
- packaged macOS arm64 `scrcpy --version`: scrcpy 4.1
- packaged macOS arm64 `adb version`: Android Debug Bridge 1.0.41, platform-tools 37.0.0
- no Android device was attached to the release host

## Published tag workflow result

The [`v2.4.0` Release workflow](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31890315296) completed successfully on macOS, Windows, and Linux. It:

1. runs the complete test suite on the macOS, Windows, and Linux packaging jobs;
2. downloads the checksum-pinned official scrcpy 4.1 bundle;
3. builds every configured installer/archive;
4. extracts the current-architecture archive on each host and executes its packaged `scrcpy --version` and `adb version`;
5. uploads every package plus `SHA256SUMS.txt`;
6. leaves Chocolatey Community publishing conditional on the real `CHOCO_API_KEY` secret.

The published [Scrcpy GUI 2.4.0 release](https://github.com/SimonAKing/scrcpy-gui/releases/tag/v2.4.0) is neither a draft nor a prerelease. It contains four macOS files, five Windows files plus `.nupkg`, four Linux files, and one checksum manifest (15 assets total). All 14 package entries in `SHA256SUMS.txt` were matched against the corresponding uploaded asset digests. The optional Chocolatey Community step reported that `CHOCO_API_KEY` was not configured and correctly skipped the external push; issue #139 therefore remains open.

## Published installer lifecycle result

The post-release [`v2.0.0-beta.6` → `v2.4.0` installer lifecycle run](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31892365146) passed against downloaded GitHub Release assets:

- macOS (13s): architecture-matching DMG mount, previous app copy to `/Applications`, stable replacement, bundle/runtime version checks, and removal;
- Windows (33s): x64 NSIS silent previous install, stable upgrade, registry/runtime version checks, and registered silent uninstall;
- Ubuntu (43s): amd64 Debian package install, stable upgrade using Debian-native version metadata, runtime checks, and package removal.

Every current asset was matched to its published `SHA256SUMS.txt` entry before installation. Each installed package then executed bundled scrcpy 4.1 and ADB 1.0.41. This is hosted-runner lifecycle evidence, not a claim that interactive installer wording, signing reputation, or retained user preferences were manually reviewed.

## Explicitly unverified in this release run

- physical Android screen/audio/recording and multi-device sessions;
- Camera, Virtual display, V4L2, Control-only, and OTG hardware paths;
- Android 11+ pairing/mDNS against a physical device;
- manual interactive install, upgrade, and uninstall UX on each host OS;
- code signing, Apple notarization, and Windows publisher reputation;
- Chocolatey Community moderation/availability until the external repository accepts the package.

These gaps are release-note disclosures, not claims that the features fail. They are also not converted into support claims from fake-binary, parser, or CI packaging evidence.
