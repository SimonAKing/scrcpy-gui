# Advanced automation proposal (#222)

This is the implementation plan for [#222](https://github.com/SimonAKing/scrcpy-gui/issues/222), not a list of shipped features. Keep the issue open until the phases below have separately passed their acceptance criteria.

## Current behavior

The GUI launches scrcpy in a separate native window. **Record actions** records GUI control-panel actions, not native-window mouse or keyboard input. The workflow editor and runner already support manually authored normalized taps, swipes, non-sensitive text, app launch, screenshots, delays, controls, and device assertions. Batch file push exists separately from workflow steps. Workflow imports are untrusted previews; arbitrary shell execution is rejected.

## 1. Record screen interactions

First choose an explicit input-capture surface. The current separate scrcpy window provides no DOM pointer or keyboard events to the GUI; adding renderer event listeners cannot record its interactions. Investigate upstream integration or an opt-in GUI capture surface before promising native-window recording. Avoid global input hooks that also capture unrelated desktop applications.

Acceptance criteria:

- Record taps, swipes with duration, and explicitly entered non-sensitive text from the chosen surface and replay them through existing step types.
- Map the displayed content rectangle to normalized device coordinates, accounting for letterboxing, crop, rotation, and scaling; reject clicks outside the content.
- Show a visible recording state and an editable preview; stop on disconnect or capture-surface closure.
- Verify portrait/landscape replay, device size changes, cancellation, and that typing in another desktop app is never recorded.

## 2. Per-run string variables

Add bounded string assignment and substitution with explicit errors for missing names. Isolate values by run and device so concurrent batches cannot share data. Imported workflows must not inherit prior run values.

Clipboard capture needs a separate design decision: clipboard synchronization with scrcpy is not equivalent to reading selected Android text. Specify supported data sources and require explicit user action for host clipboard access. Do not imply that arbitrary Android app text is readable.

Acceptance criteria:

- Assign, reuse, and preview non-sensitive string values; test missing variables, size limits, cancellation, and concurrent-device isolation.
- Do not persist captured values into workflows, exports, event logs, diagnostics, or history by default.
- Review the workflow schema migration and import preview before introducing new steps.

## 3. Workflow upload and download

Reuse the existing device/file validation and selected-file handling for upload. Add an explicit pull operation with a user-selected destination. Bind host paths locally rather than trusting paths from imported workflows, and define variable substitution before allowing it in transfer paths.

Acceptance criteria:

- Upload a selected file, then pull a generated file to an approved destination and return a per-step result.
- Define conflict behavior and handle traversal, symlinks, overwrites, permission failures, missing files, disconnects, partial transfers, and cancellation.
- Preview file directions and destinations before execution; keep host-specific file selections out of portable exports.

## 4. Local command execution

This introduces host execution into an engine that currently rejects shell commands. Keep it a separately reviewed capability with local executable selection and an argv array; never build a shell command from variable values. The renderer must continue to use guarded typed IPC.

Acceptance criteria:

- Require explicit per-workflow permission tied to the locally reviewed command. Imported or edited commands lose that grant and cannot execute during preview.
- Bound execution time and captured stdout/stderr; define working directory, environment, accepted exit codes, and cancellation of child processes on each supported OS.
- Expose bounded stdout to a per-run variable only when requested. Redact outputs from diagnostics and persistent logs by default.
- Test argv metacharacters, untrusted imports, denied permission, timeouts, nonzero exits, cancellation, and concurrent runs on Windows, macOS, and Linux.

Each phase should ship in a focused PR with schema/validation, runner, typed preload API, UI, documentation, and behavior tests as applicable. Native-window recording and Android clipboard capture still need feasibility evidence; neither is implied by the existing action recorder.
