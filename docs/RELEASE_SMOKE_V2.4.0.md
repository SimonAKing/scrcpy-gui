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

## Tag workflow gates

The `v2.4.0` tag is publishable only after the Release workflow:

1. runs the complete test suite on the macOS, Windows, and Linux packaging jobs;
2. downloads the checksum-pinned official scrcpy 4.1 bundle;
3. builds every configured installer/archive;
4. extracts the current-architecture archive on each host and executes its packaged `scrcpy --version` and `adb version`;
5. uploads every package plus `SHA256SUMS.txt`;
6. leaves Chocolatey Community publishing conditional on the real `CHOCO_API_KEY` secret.

Expected assets are four macOS files, five Windows files plus `.nupkg`, four Linux files, and one checksum manifest (15 total). The release is not accepted if the workflow fails, the asset count differs, or any manifest entry does not match its uploaded file.

## Explicitly unverified in this release run

- physical Android screen/audio/recording and multi-device sessions;
- Camera, Virtual display, V4L2, Control-only, and OTG hardware paths;
- Android 11+ pairing/mDNS against a physical device;
- manual install, upgrade, and uninstall behavior on each host OS;
- code signing, Apple notarization, and Windows publisher reputation;
- Chocolatey Community moderation/availability until the external repository accepts the package.

These gaps are release-note disclosures, not claims that the features fail. They are also not converted into support claims from fake-binary, parser, or CI packaging evidence.
