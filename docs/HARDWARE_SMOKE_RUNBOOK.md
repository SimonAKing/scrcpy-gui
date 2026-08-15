# Physical Android hardware smoke runbook

This runbook closes hardware evidence gaps; it is not a simulator test and does not convert fake ADB output into a support claim.

## 1. Generate the preflight report

Connect and authorize one physical Android device, then run:

```bash
npm run prepare:scrcpy
npm run smoke:hardware -- --output hardware-smoke-report.json
```

When more than one authorized device is attached, select one explicitly:

```bash
npm run smoke:hardware -- --serial SERIAL --output hardware-smoke-report.json
```

The tool exits successfully only for one selected, authorized, non-emulator target. It records host/Android metadata, display size, encoders, displays, cameras, and camera sizes. The report replaces the ADB serial with a stable short hash and redacts addresses and home paths. It never treats the capability probes as scene success.

Do not commit a hardware report without reviewing it. Attach the reviewed report to the release evidence or test record instead.

## 2. Execute every pending scene

Use the same installed release package throughout the run. For every row, record `pass`, `fail`, `unsupported`, or `unavailable`, plus an artifact/log reference and a short observation.

| Scene | Required observation |
| --- | --- |
| Screen | real display appears; keyboard/mouse control works; session stops cleanly |
| Audio | forwarded audio is audible on a supported Android version; unsupported versions are recorded, not passed |
| Record-only | output file is created, indexed, playable, and finalized after stop |
| Camera | selected camera/size/fps starts or returns a structured device error |
| Virtual display | selected app opens on the created display and close behavior matches the preview |
| Control-only | input works with video/audio disabled and no false playback state |
| OTG | control works through the no-ADB path; USB debugging is not used as evidence |
| V4L2 | on Linux with `v4l2loopback`, the chosen sink receives frames; otherwise mark host unavailable |
| Pairing/mDNS | Android 11+ pairing succeeds, connection address is remembered, and discovery reconnects |
| Multi-device | two physical devices launch independently and partial failure is reported per device |

Capture the Scrcpy GUI diagnostic ZIP and relevant screenshots/recordings after the run. Review redactions before sharing.

## 3. Matrix metadata

Record without raw serial numbers:

- release version and package checksum;
- host OS and architecture;
- Android release/API, manufacturer, and model from the preflight report;
- USB, legacy TCP/IP, or Android 11+ pairing connection;
- scene outcome and artifact/log reference;
- every unavailable vendor/Android/host cell.

At least one physical device and one host must pass the M0 baseline. M3 additionally requires at least one real hardware run for every scene; a mode may be `unsupported` for a specific device, but that result must be preserved instead of silently omitted.
