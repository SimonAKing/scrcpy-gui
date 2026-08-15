# Frequently asked questions

## Why does the app say scrcpy or adb is missing?

Choose the `scrcpy` executable in Runtime setup. Scrcpy GUI also checks the same directory for `adb`; otherwise, both commands must be available on `PATH`.

## Why does my device show as unauthorized?

Unlock the Android device and accept its USB debugging prompt, then refresh the device list. If no prompt appears, revoke USB debugging authorizations in Developer options and reconnect the cable.

## Why did the mirror close immediately?

Open the **Logs** tab. Version 2 reports scrcpy's actual stderr rather than treating any process output as a successful launch. Confirm the same command works with scrcpy 4.x before filing an issue.

## How do I use Android 11+ wireless debugging?

Use the phone's **Pair device with pairing code** screen first. The pairing port and connection port are usually different. Pair with the first address and six-digit code, then connect using the address shown on the main Wireless debugging screen.

## Why does Ctrl+X behave differently in the mirror?

Keep **Shortcut modifier** set to **System default**. Version 1.x forced Ctrl as scrcpy's modifier, which intercepted Ctrl-based shortcuts. Version 2 no longer overrides the upstream default.

## Which information belongs in a bug report?

- Scrcpy GUI version
- scrcpy version
- Operating system and architecture
- Android device and version
- Whether the current scrcpy CLI works
- Logs tab output with secrets and private network details removed
