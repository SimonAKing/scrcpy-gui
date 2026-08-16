# v2.4.1 Release verification

v2.4.1 is a GPL-3.0-only security and release-provenance patch over v2.4.0. It deliberately does not apply the pending MIT change or claim new physical-device coverage.

## Verified before tagging

- `package.json`, `package-lock.json`, and the Chocolatey manifest all declare version `2.4.1`;
- `package.json` and the project `LICENSE` remain GPL-3.0-only;
- `npm test`: 21 test files / 185 tests;
- `npm run build`, including the Node and Renderer type checks;
- `npm run icons:check`: 11 generated icon assets;
- pull-request validation on macOS, Ubuntu, and Windows;
- pull-request CodeQL analysis and the latest `master` analysis report no open alerts;
- no physical Android device was attached to the release host.

## Tag workflow gates

The tag workflow must independently:

1. run the full tests and build each configured macOS, Windows, and Linux package;
2. download only the checksum-pinned official scrcpy 4.1 bundles;
3. extract the current-architecture archive on each runner and execute packaged scrcpy 4.1 and ADB 1.0.41;
4. build the Chocolatey package with the final Windows installer SHA-256;
5. export a non-empty SPDX 2.3 SBOM from GitHub's dependency graph;
6. include every package and the SBOM in `SHA256SUMS.txt`;
7. generate GitHub/Sigstore build-provenance attestations before publishing the assets.

The release must stay unpublished if any required packaging, smoke, checksum, SBOM, or attestation step fails. Chocolatey Community publication remains an optional final job until `CHOCO_API_KEY` is configured.

## Published result

The final [`v2.4.1` Release workflow](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31940894381) passed every required job from the tag that peels to commit `8487b019e7bda281e0c2da1324ed8386eec51ce6`:

- macOS, Windows, and Linux each completed tests, packaging, final-archive extraction, and packaged scrcpy 4.1 / ADB 1.0.41 execution;
- Windows also built `scrcpy-gui.2.4.1.nupkg` with the final x64 installer checksum;
- the published stable [v2.4.1 release](https://github.com/SimonAKing/scrcpy-gui/releases/tag/v2.4.1) contains 16 assets: 14 platform/Chocolatey packages, one SPDX SBOM, and `SHA256SUMS.txt`;
- all 15 non-manifest assets are present in `SHA256SUMS.txt`, and every listed digest matches GitHub's uploaded-asset digest;
- the SPDX 2.3 SBOM contains 466 packages;
- strict `gh attestation verify` checks for the Chocolatey package, SBOM, and checksum manifest passed with the repository, `release.yml`, tag ref, source commit, and GitHub-hosted runner identity pinned;
- the single SLSA provenance statement covers all 16 published assets and identifies `release.yml@refs/tags/v2.4.1` as its builder.

The optional Chocolatey Community job completed safely without a push because `CHOCO_API_KEY` is not configured. The verified `.nupkg` is attached to the GitHub release, while issue #139 remains open for real Community submission, moderation, and install/upgrade evidence.

## Published installer lifecycle result

The post-release [`v2.4.0` → `v2.4.1` installer lifecycle run](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31942357974) passed against the published assets:

- macOS (17s): selected the runner-architecture DMG, installed v2.4.0 into `/Applications`, replaced it with v2.4.1, checked the bundle/runtime versions and production `file://` Renderer startup, then removed the app;
- Ubuntu (45s): verified and installed the v2.4.0 Debian package, upgraded to v2.4.1, checked dpkg/runtime versions and Renderer startup under Xvfb, then removed the package;
- Windows (2m16s): silently installed the v2.4.0 x64 NSIS package, upgraded to v2.4.1, checked registry/runtime versions and production Renderer startup, then ran the registered uninstaller and confirmed removal.

Every v2.4.1 installer was matched to its published `SHA256SUMS.txt` entry before installation. This is hosted-runner native install/upgrade/startup/uninstall evidence; it does not replace manual interactive UX, signing reputation, preference-retention, or physical-device verification.

## Pre-publication correction

The first tag attempt failed before creating any GitHub Release or assets: GNU tar required explicit gzip mode for streamed `.tar.gz` input, and Windows tar stdin extraction produced a runtime that failed DLL loading. PRs #202 and #203 fixed those platform-specific extraction paths, added a permanent Windows prepared-runtime gate, and passed three-platform validation plus CodeQL. The unpublished tag was then recreated on the verified fix commit before the successful workflow above. The original source state remains recoverable at commit `e372f45f559b5be6598700fc0a059267f0178375`.

## Explicitly unverified

- physical Android screen, audio, recording, pairing, multi-device, Camera, Virtual display, V4L2, Control-only, and OTG paths;
- manual interactive installer wording and retained-preference review on each host OS;
- Apple signing/notarization, Windows publisher reputation, and Chocolatey Community moderation.

These are disclosed evidence gaps, not inferred feature failures or successes.
