# v2.4.3 Release verification

v2.4.3 is the publishable MIT licensing patch. It supersedes the unpublished `v2.4.2` tag without moving or rewriting that public tag.

## v2.4.2 failure record

The v2.4.2 release workflow passed macOS and Linux packaging but stopped before publication in the Windows packaged-runtime smoke. Git for Windows checked out the MIT license with CRLF line endings, while the smoke accepted only an LF header. The package still contained the MIT text; the verifier rejected the valid Windows representation.

v2.4.3 accepts `MIT License` followed by either LF or CRLF and reports project-license and upstream-license failures independently.

## Required before tagging

- completed current-tree relicensing audit recorded in `RELICENSING_V2.4.2.md`;
- `npm test`;
- `npm run typecheck`;
- `npm run build`;
- macOS, Windows, and Linux pull-request checks;
- CodeQL analysis with no open alert on the release revision;
- final archives contain `LICENSE.scrcpy-gui.txt`, `THIRD_PARTY_NOTICES.md`, and the platform-specific upstream scrcpy license file;
- packaged `scrcpy --version` and `adb version` checks remain successful;
- the Release workflow publishes a checksummed SPDX 2.3 SBOM and GitHub/Sigstore attestations for all release assets.

The physical-device, signing/notarization, manual installer, and Chocolatey Community gaps disclosed for v2.4.1 remain unchanged.
