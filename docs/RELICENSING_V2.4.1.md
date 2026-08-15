# v2.4.1 relicensing record

This record explains the prospective Scrcpy GUI license change from GPL-3.0-only to MIT. It is an engineering provenance audit, not a claim that previously distributed copies changed license.

## Scope

- Tagged releases through `v2.4.0` remain under the GPL-3.0-only terms shipped with those copies.
- The MIT change applies to `v2.4.1` and later source/releases only after this change is merged.
- The official scrcpy runtime bundled with release packages remains a separate Apache-2.0 project. Its upstream `LICENSE` file is preserved in each package.

## Current-tree contribution audit

Repository history and merged pull requests were checked for non-maintainer authors:

- #18 added an old tray component and `static/icons/16x16.png`. The component was already removed; this change removes the unused icon. The active `build/icons/16x16.png` was independently regenerated in #171 and has a different blob/hash.
- #29, #37, and #88 changed Vue 2/router/legacy scrcpy paths that no longer exist in the current tree.
- #69 supplied Russian localization that was later migrated into the v2 i18n implementation. Although #69 was closed rather than merged, the project explicitly credits that provenance; an explicit MIT relicensing reply from @dEN5-tech is therefore required before merge.

The package dependency metadata contains permissive and weak-copyleft third-party licenses but no GPL dependency. Those dependencies keep their own licenses; the project-level MIT declaration does not overwrite them.

## Required evidence before merge

- [ ] @dEN5-tech explicitly agrees in #69 to license the migrated Russian translation contribution under MIT.
- [x] No current-tree content from #29, #37, or #88 remains.
- [x] The remaining #18 asset is removed instead of being relicensed by assumption.
- [x] The current packaged runtime contains the upstream scrcpy Apache-2.0 license.
- [x] The maintainer [publicly attests](https://github.com/SimonAKing/scrcpy-gui/pull/190#issuecomment-5303383152) that the Simon Ma-authored portions may be relicensed and are not restricted by an employer, school, or other IP agreement.
- [x] The latest merged `master` passes local typecheck, 20 files / 182 tests, build, 11-icon check, and packaged-runtime license smoke on this branch.
- [x] The latest merged `master` passes [three-platform pull-request CI](https://github.com/SimonAKing/scrcpy-gui/actions/runs/31898349699) on this branch (macOS 20s, Ubuntu 25s, Windows 49s).

The remaining unchecked contributor-consent item is a merge blocker. Passing tests or maintainer ownership of other files cannot replace it.
