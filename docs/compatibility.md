# Windows / DSH compatibility

> Last updated: 2026-11-19 (release 0.4.147).

## Tested here

| Item | Value |
|---|---|
| OS | Windows 11 (build 26200) |
| DSH | 0.2.2-rc.3 installed; last manual package smoke was on 0.2.2-rc.1 |
| Node | 26.13.0 |
| Public package | `dsh-cortex-memory` 0.4.147 |
| Data root | `~/.dsh/cortex-memory` (migrated from `~/.dsh/cortex`) |
| Native dependencies | none required |
| Tests | 520 unit + 126 integration (CI green on the 0.4.147 commit) |
| Package smoke | 135-file tgz (328,615 bytes), no `test/`, extracted and started |

## What was actually checked

1. `npm pack` produced a 135-file tgz (328,615 bytes) with `dsh.bundle.patch`;
   `test/` is not shipped.
2. The tgz was extracted; `createCortex` wrote, searched and health-checked.
3. The public source tests passed: 520 unit / 126 integration in CI (2026-11-19).
4. The client bundle is a DSH web client plugin; the host row is a bundle patch.
5. No absolute personal paths or credentials are required.
6. The published tgz hash matches the GitHub Release `SHA256SUMS.txt`.

## Hard requirements

- **Node.js >= 24** — the engine uses `node:sqlite`.
- **DSH >=0.2.1-rc.2 <0.5.0**.
- A profile may run only one plugin whose host id is `dsh-cortex-memory`
  (releases before the rename used the id `cortex`, and need one migration).

## Not yet verified

- Installation into a brand-new DSH profile from the exact release tgz.
- A click-through browser E2E of every panel control.
- Manual smoke on DSH 0.2.2-rc.3 — the numbers above come from CI, not a fresh install.
- Node 20/22 users.
- Very old DSH releases.
- Running alongside the private development build that uses the same `cortex` id.

Do not claim “works for every Windows/DSH user” until a clean-profile
installation is done on a machine without the development build.
