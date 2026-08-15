# Published installer lifecycle smoke

The `Installer lifecycle smoke` workflow validates real GitHub Release assets rather than build-directory approximations. A maintainer supplies an already published previous version and current version; the default path is `v2.0.0-beta.6` → `v2.4.0`.

## Covered paths

| Host | Published asset | Lifecycle |
| --- | --- | --- |
| macOS | architecture-matching DMG | mount, copy the previous app to `/Applications`, replace it with the current app, verify bundle/runtime versions, remove the app |
| Windows | x64 NSIS installer | silent previous install, silent current upgrade, verify registry/runtime versions, registered silent uninstall |
| Ubuntu | amd64 Debian package | `apt` previous install, `apt` current upgrade, verify dpkg/runtime versions, package removal |

The current release asset must match its published `SHA256SUMS.txt` entry before installation. Version inputs are syntax-validated and downloads are restricted to this repository's releases.

Linux comparisons use the `Version` field embedded in each Debian package. This is intentionally not compared directly with the Git tag because Debian encodes prerelease ordering with `~` (for example, tag `2.0.0-beta.6` becomes package version `2.0.0~beta.6`).

## Evidence and limits

This workflow proves that representative native installer formats can install, upgrade, expose the expected bundled scrcpy/ADB runtime, and uninstall on clean hosted runners. It does not prove code-signing reputation, Apple notarization, interactive installer wording, retained user preferences, every Linux package format, physical Android behavior, or Chocolatey Community availability.

Record each accepted run URL and exact input versions in the corresponding release smoke report. A green build/package job is not a substitute for this lifecycle workflow.
