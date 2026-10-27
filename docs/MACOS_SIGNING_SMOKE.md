# macOS signing fix verification (#228)

Verified on an Apple Silicon Mac on 2026-10-15.

## Reproduction

Downloaded the published `Scrcpy.GUI-2.4.5-mac-arm64.zip` and checked it against its release `SHA256SUMS.txt`. The checksum matched. After extraction, `codesign --verify --deep --strict --verbose=2 'Scrcpy GUI.app'` failed with:

```text
code has no resources but signature indicates they must be present
```

The Release workflow disables certificate auto-discovery, and electron-builder 26.15.3 does not automatically ad-hoc sign without an identity. Repackaging Electron changes its resources and metadata, leaving its inherited signature invalid.

## Fix and checks

Set `build.mac.identity` to `-` to sign the completed bundle explicitly. Disable hardened runtime for this ad-hoc build so framework loading does not require a shared Developer ID team. A future Developer ID/notarized distribution should enable hardened runtime with appropriate entitlements.

- All 202 tests passed, including three issue-helper regressions; type checking and production build passed with the three dependency PRs combined.
- Built Intel and Apple Silicon DMG/ZIP packages with Electron 43.5.0 and certificate auto-discovery disabled, matching the Release environment.
- The updated packaged-runtime smoke passed strict recursive signature checks for both ZIPs and license checks for both bundles. Native arm64 scrcpy 4.1 and ADB 1.0.41 ran successfully without Rosetta.
- Mounted both DMGs read-only and verified each contained application's signature with `codesign --verify --deep --strict`; both passed.
- Launched the packaged arm64 app with an isolated user-data directory and checked through its debugging endpoint that the production renderer displayed Scrcpy GUI and the typed preload API loaded. Removed the isolated profile and terminated the smoke-test process afterward.
- macOS packaging refreshes the bundled scrcpy/ADB signatures too; upstream notices now disclose this rather than calling the packaged files unmodified.

The Release smoke now rejects invalid signatures in either architecture instead of only executing bundled scrcpy/ADB on the runner's architecture.

## Limits

Ad-hoc signing provides integrity, not Developer ID identity or Apple notarization. These checks do not prove Gatekeeper acceptance for a browser-downloaded, quarantined application. User confirmation may still be required. No Android hardware result or Windows/Linux installer result is inferred from this macOS verification.
