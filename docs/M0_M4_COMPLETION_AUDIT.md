# M0–M4 completion audit

Audit baseline: `master` after PR #196, 2026-08-15. This document treats missing direct evidence as incomplete; parser tests and CI are not substituted for physical-device results.

## Status vocabulary

- **Complete**: the implementation exists and evidence covers the stated acceptance scope.
- **Software complete / hardware pending**: implementation and controlled failure paths are verified, but the milestone explicitly requires hardware evidence that is unavailable.
- **External pending**: completion depends on a credential, moderation result, or other state outside the repository.

## Release acceptance

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| Unit/integration/typecheck/build on three hosts | Complete | Validate jobs on PR #196; 19 files / 177 tests after tagged migration coverage in #194 |
| Official scrcpy download and SHA-256 | Complete | pinned scrcpy 4.1 hashes in `scripts/fetch-scrcpy.mjs`; [v2.4.0 release workflow](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31890315296) |
| Stable, complete asset names | Complete | v2.4.0 has 15 assets across macOS, Windows, Linux, Chocolatey package, and manifest |
| Execute packaged scrcpy/ADB | Complete | release jobs execute scrcpy 4.1 and ADB 1.0.41 from extracted final archives |
| Installed GUI starts on three hosts | Complete | [published-asset lifecycle/startup run](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31892938302) loads the production `file://` Renderer on macOS, Windows, and Ubuntu/Xvfb |
| Install, upgrade, uninstall | Complete for hosted native paths | the same run performs beta.6 → v2.4.0 lifecycle through DMG, NSIS, and Debian packages; interactive UX remains a disclosed manual gap |
| Asset manifest | Complete | all 14 package entries matched `SHA256SUMS.txt` and uploaded digests |
| Issue reply with release and verification | Complete where the request is fulfilled | #139 has a v2.4.0 reply but remains open because Community publication has not occurred |

## M0 — stable baseline

### Complete

- high-impact UI/icon/overflow work, including checked 880×640, 1120×780, 1440×900, and DPR 2 layouts;
- packaged-runtime smoke and installed-GUI lifecycle/startup smoke;
- trusted IPC sender, payload, navigation, CSP, and contract coverage;
- fake process launch/startup/exit/fatal/duplicate-session integration tests;
- bug template, diagnostics, changelog, release notes, and stable v2.4.0 publication;
- explicit migration cases for the real persisted shapes in v2.0.0-beta.1, beta.2, and beta.3;
- no open P0 issue; the only open issue is the Chocolatey enhancement #139.

### Not complete

- **One real Android device has not passed the stable baseline.** No device was attached (`adb devices -l` returned an empty list), so the M0 exit condition cannot be inferred from fake ADB or an installed GUI startup.
- **Chocolatey Community publication is external pending.** `CHOCO_API_KEY` is not configured; a verified `.nupkg` exists, but `choco install/upgrade scrcpy-gui` from the Community Repository cannot yet be tested and #139 must remain open.

M0 status: **software/release automation complete; milestone exit still blocked by real-device and Community publication evidence.**

## M1 — capability and session foundation

Status: **Complete in software scope.**

- `OptionDescriptor`/capability derivation and provenance-aware argv preview: `tests/options.test.ts`, `tests/scrcpy.test.ts`;
- session identity, startup window, fatal detection, conflicts, and lifecycle: `tests/sessionManager.test.ts`;
- streaming/fallback device tracking: `tests/deviceTracker.test.ts`;
- structured bounded events/errors and Sessions UI: `tests/eventStore.test.ts`, `tests/errors.test.ts`;
- atomic Config V3, recovery, revision conflicts, future-schema refusal, and tagged beta migration: `tests/configRepository.test.ts`.

## M2 — device workspace and artifacts

Status: **Complete in software scope.**

- device overview, app discovery/start, file push, conflict policy, and APK install with per-device results: `tests/deviceWorkspaceService.test.ts`;
- reconciled screenshot/recording/report/diagnostic artifacts and partial results: `tests/artifactService.test.ts`;
- bounded, path-safe, default-redacted diagnostics: `tests/diagnosticsService.test.ts`;
- declarative Profile preview/import/export with local-path and managed-flag controls: `tests/profileTransferService.test.ts`.

The services have controlled fake-ADB and filesystem evidence. Physical transfer/install behavior remains part of the hardware matrix rather than being promoted from those tests.

## M3 — scrcpy 4.x scenes

Status: **Software complete / hardware pending.**

Complete software evidence:

- independent Screen, Camera, Virtual display, Record-only, Control-only, and no-ADB OTG scene workflows;
- official argv construction, conflict matrix, Profile round-trip, output preflight, and Linux-only V4L2 gates: `tests/scenes.test.ts`, `tests/outputPreflight.test.ts`;
- bounded per-device encoder/display/camera probes with caching and partial-failure results: `tests/deviceCapabilityService.test.ts`;
- responsive guided UI and exact command preview.

Missing exit evidence:

- no physical Camera, Virtual display, Record-only, Control-only, OTG, or Linux V4L2 run;
- no physical screen/audio/recording result;
- no Android 11+ pairing/mDNS run;
- no multi-device physical session.

The milestone requires at least one platform hardware smoke for every mode. It therefore remains incomplete even though failure paths and serialization are tested.

## M4 — device groups and safe automation

Status: **Complete in software scope.**

- stable device groups, default profiles, concurrency bounds, offline membership, and scene/group composition;
- per-device preflight and final partial reports for launch, screenshot, app start, control, file push, APK install, and Automation V2;
- normalized tap/swipe against live geometry, non-sensitive text, assertions, cancellation, and per-step events;
- reviewed import preview, arbitrary-shell/sensitive-text rejection, overwrite/input/downgrade confirmations;
- main-process concurrency caps and persisted reports.

Evidence: `tests/batchAutomationService.test.ts`, `tests/automationRunner.test.ts`, `tests/automationTransferService.test.ts`, `tests/ipcContract.test.ts`, and artifact/config tests. The exit invariants—no false overall success, confirmation for dangerous actions, and no raw shell—are directly asserted.

## Research boundary

No Research item has been promoted into the roadmap. Searches of source and tests show no embedded mirror, plugin API, or claimed low-latency key-mapping implementation. Existing window/session controls are M1–M4 functionality, not evidence for the v3 research candidates.

Research remains intentionally unimplemented until a prototype, cross-platform measurements, security review, and maintainer commitment exist.

## Evidence required to close the full objective

1. Attach at least one authorized physical Android device and record the M0 baseline plus every M3 scene's success/failure evidence.
2. Expand the physical matrix as available across Android versions, vendors, USB/TCP/IP/pairing, hosts, screen/audio/recording, and multiple devices; disclose every unavailable cell.
3. Configure a real Chocolatey maintainer credential, submit the package, wait for moderation, and verify Community `install` and `upgrade` before closing #139.
4. Keep signing/notarization and manual interactive installer UX disclosed until separately exercised; neither is inferred from hosted-runner startup.

The separate MIT v2.4.1 Draft (#190) also requires explicit consent for the migrated #69 Russian translation and confirmation that maintainer-authored work is free of employer/school/IP restrictions. It is not counted as an M0–M4 completion claim.

Use the [physical hardware smoke runbook](HARDWARE_SMOKE_RUNBOOK.md) and `npm run smoke:hardware` to generate the redacted preflight report and execute the remaining scene checklist. A `blocked` preflight report is evidence that prerequisites are missing, not evidence that a scene passed.
