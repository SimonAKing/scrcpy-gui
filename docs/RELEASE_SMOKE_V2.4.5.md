# v2.4.5 Release verification

v2.4.5 is a single-issue patch release. It stops Scrcpy GUI from leaving the bundled `adb` running after the app quits, which kept the install directory locked on Windows and prevented the app from being updated or moved (#219).

## Quit behavior

- Every quit route — the tray menu, the window close button, `Cmd+Q`, and `window-all-closed` — now enters one guarded shutdown. A second quit request while shutdown is running no longer terminates the app mid-cleanup.
- The window is hidden as soon as shutdown begins, so quitting from the tray responds immediately instead of appearing inert while ADB is stopped.
- Shutdown is bounded by a five-second timeout, so an unresponsive `adb` cannot prevent the app from quitting.
- The ADB server is stopped whenever Scrcpy GUI was the process that started it. Ownership is claimed only from adb's own `daemon not running` / `daemon started successfully` output, so a server that was already running when the app launched is still left alone unless "Stop the shared ADB server when quitting" is enabled.

## Completed before tagging

- all 199 tests across 23 test files pass with Vitest 4.1.11;
- `npm run typecheck` passes;
- `npm run build` produces the main, preload, and Renderer bundles;
- `npm audit` reports no production or development dependency vulnerabilities;
- the leak and the fix were reproduced against the real bundled `adb` on macOS: starting device tracking makes adb report that it had to start the server itself, the server process is observable while tracking runs, and after the tracker stop plus `adb kill-server` performed by the shutdown path no `adb` process remains.

## Not verified

The Windows directory-locking symptom reported in #219 was not reproduced on Windows hardware; the fix was verified through the ADB process behavior above, which is the mechanism behind that symptom. The physical-device, signing/notarization, manual installer, and Chocolatey Community verification gaps disclosed for v2.4.1 remain unchanged. The tag-triggered Release workflow remains responsible for building all platform packages, checking bundled `scrcpy` and `adb`, generating checksums and the SPDX SBOM, attesting the release assets, and publishing the GitHub Release.
