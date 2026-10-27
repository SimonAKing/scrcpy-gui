# v2.5.0 Release verification

This release includes background recording controls, macOS device shortcuts, and Finder APK opening from #235, with maintainer security and compatibility fixes. It also includes the previously unreleased macOS signing and issue-form fixes from master.

## Security and compatibility checks

- Every APK opened by macOS requires an installation confirmation showing its full path and target device. Cancel is the default. Replacement requires an unchecked-by-default checkbox, and downgrade stays disabled. Tests cover cancellation, explicit replacement, multiple targets, unauthorized/offline targets, and device-enumeration failure.
- A main-process integration test opens an APK before app readiness and verifies that no device enumeration occurs until configuration migration finishes, then verifies that the configured custom runtime is used. The pending queue is bounded to 50 files and rejects new work while quitting.
- The five new macOS shortcuts use the focused application's `before-input-event` handler. No global registrations are made for these shortcuts. Integration tests reject hidden/unfocused or untrusted windows; key handling tests reject repeats, composition, and unrelated modifiers. The existing opt-in Boss key remains global.
- Existing assigned recording profiles retain fixed filenames and container settings. Folder-based recording restores the previous directory and inferred container when needed, supports WAV/raw audio, and generates unique filenames. Tests exercise both profile and folder paths.
- New privileged operations continue to use argv-based ADB execution, sandboxed renderers, context isolation, sender validation, and the existing typed preload bridge.

## Local verification

- `npm test`: 226 tests across 27 files, including mocked main-process integration. No APK was installed and no Android device was accessed by these tests.
- `npm run build`: Renderer and main-process type checks plus production builds.
- `npm run icons:check`: generated icon consistency.
- `npm audit`: 0 reported vulnerabilities after updating Electron, Vite, Vitest/mocker, fast-uri, http-cache-semantics, and both Undici versions. The final lockfile is verified with a clean `npm ci`.
- `package.json`, the lockfile root package, and the Chocolatey manifest declare version 2.5.0.

## Release gates and limits

The Validate workflow runs tests and production builds on Linux, macOS, and Windows. The tag-triggered Release workflow builds all supported packages, verifies bundled runtimes and macOS signatures, and publishes only after all packaging jobs succeed. Publication includes SHA-256 checksums, an SPDX SBOM, and build-provenance attestations.

Physical-device recording finalization and installation, Finder association behavior on an installed app, and interactive shortcut behavior have not been manually verified on hardware in this review. macOS builds are ad-hoc signed and remain unnotarized. Automated tests and packaging checks do not establish those hardware or interactive results.
