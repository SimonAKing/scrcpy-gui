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

## Explicitly unverified

- physical Android screen, audio, recording, pairing, multi-device, Camera, Virtual display, V4L2, Control-only, and OTG paths;
- manual interactive installer wording and retained-preference review on each host OS;
- Apple signing/notarization, Windows publisher reputation, and Chocolatey Community moderation.

These are disclosed evidence gaps, not inferred feature failures or successes.
