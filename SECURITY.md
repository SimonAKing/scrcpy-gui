# Security policy

## Supported versions

Security fixes are provided for the latest stable `2.4.x` release line. Older beta and `1.x` releases are no longer supported; reproduce a report on the latest stable release when practical.

## Private reporting

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/SimonAKing/scrcpy-gui/security/advisories/new), or email the maintainer address listed in `package.json`, so the maintainer can investigate before details or exploit steps are public.

Include:

- the affected Scrcpy GUI, operating-system, scrcpy, ADB, and Android versions;
- the security boundary involved, such as IPC, command construction, local files, diagnostics/redaction, updates, or release integrity;
- minimal reproduction steps and the expected versus observed result;
- impact and prerequisites, including whether user interaction or an already-authorized device is required;
- a redacted diagnostic bundle when it is relevant.

Never submit real pairing codes, API keys, access tokens, raw device serials, private addresses, or unnecessary local paths. Review every attachment even when Scrcpy GUI generated it with default redaction.

The maintainer aims to acknowledge a complete report within seven days and provide an initial assessment or request for evidence within fourteen days. Resolution and disclosure timing depend on severity, reproducibility, upstream coordination, and release readiness.

## Coordinated disclosure

Please allow a reasonable remediation window before public disclosure. Confirmed vulnerabilities will be handled through a GitHub Security Advisory where appropriate, with affected versions, mitigations, credit preferences, and the fixed release recorded before the advisory is published.

Security reports about scrcpy itself should be reported to [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy/security); reports about Electron, Chromium, Android platform tools, or another dependency should also be coordinated with the relevant upstream project. Scrcpy GUI will still assess whether bundling, configuration, or application behavior requires a local mitigation.
