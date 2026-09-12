# v2.4.4 Release verification

v2.4.4 fixes device screenshot capture on ADB/device combinations that do not return a valid PNG through `exec-out`, adds direct screenshot copying to the system clipboard, and includes the reviewed dependency updates from #212, #213, and #216.

## Screenshot behavior

- Keep direct `adb exec-out screencap -p` as the fast path.
- Fall back to a unique PNG in `/data/local/tmp` and `adb pull` when direct capture fails or returns non-PNG data.
- Enforce the existing 64 MiB screenshot limit and clean up local and device-side temporary files.
- Keep the existing save dialog and expose a separate copy-to-system-clipboard action.

## Completed before tagging

- all 190 tests across 22 test files pass with Vitest 4.1.11;
- `npm run typecheck` passes;
- `npm run build` produces the main, preload, and Renderer bundles;
- pull requests #212, #213, and #216 passed macOS, Windows, Linux, and CodeQL checks before merge;
- `npm audit` reports no production or development dependency vulnerabilities.

The physical-device, signing/notarization, manual installer, and Chocolatey Community verification gaps disclosed for v2.4.1 remain unchanged. The tag-triggered Release workflow remains responsible for building all platform packages, checking bundled `scrcpy` and `adb`, generating checksums and the SPDX SBOM, attesting the release assets, and publishing the GitHub Release.
