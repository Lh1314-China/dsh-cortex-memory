# Windows / DSH compatibility

## Tested here

| Item | Value |
|---|---|
| OS | Windows 11 |
| DSH | 0.2.2-rc.1 |
| Node | 26.13.0 |
| Public package | `dsh-cortex-memory` 0.1.0 |
| Data root | fresh `~/.dsh/cortex` |
| Native dependencies | none required |
| Tests | 373 passing |
| Package smoke | packed tgz extracted and started |

## What was actually checked

1. `npm pack` produced a 99-file tgz with `dsh.bundle.patch`.
2. The tgz was extracted; `createCortex` wrote, searched and health-checked.
3. The public source tests passed: 373 / 0.
4. The client bundle is a DSH web client plugin; the host row is a bundle patch.
5. No absolute personal paths or credentials are required.

## Hard requirements

- **Node.js >= 24** — the engine uses `node:sqlite`.
- **DSH >=0.2.1-rc.2 <0.4.0**.
- A profile may run only one plugin whose host id is `cortex`.

## Not yet verified

- Installation into a brand-new DSH profile from the exact release tgz.
- A click-through browser E2E of every panel control.
- Node 20/22 users.
- Very old DSH releases.
- Running alongside the private development build that uses the same `cortex` id.

Do not claim “works for every Windows/DSH user” until a clean-profile
installation is done on a machine without the development build.
