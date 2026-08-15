# Contributing

Thanks for helping maintain Scrcpy GUI. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

1. Confirm the same device works with the current scrcpy CLI.
2. Use scrcpy 4.x and the latest Scrcpy GUI beta.
3. Copy the relevant stdout/stderr from the app's **Logs** tab.
4. Search existing issues for the same device and error.

## Development

Use Node.js 22 or later:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Run the app locally with `npm run dev`. A full unpacked package can be produced with `npm run build:dir`.

## Pull requests

- Keep changes focused and explain which issue or user workflow they address.
- Add or update tests for command construction, validation, and device parsing changes.
- Never build a shell command from user input. Arguments must be passed as an array to `spawn` or `execFile`.
- Renderer features must use the typed preload API; do not enable Node integration or disable context isolation.
- Verify new scrcpy flags against the current upstream documentation.
- Update `README.md` and `CHANGELOG.md` when behavior visible to users changes.

Large changes are welcome, but please open an issue first so maintainers can agree on scope and compatibility.
