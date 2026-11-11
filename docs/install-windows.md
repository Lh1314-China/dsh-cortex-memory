# Windows install

## Requirements

- Windows 10/11
- Node.js **>= 24** (DSH ships a compatible runtime on current builds)
- DSH `>=0.2.1-rc.2 <0.4.0`

## Install from a release tgz

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-cortex-memory-0.1.0.tgz"
```

If `dsh` is not on PATH, install through **DSH → Settings → Plugins → Install**
and select the same tgz.

## Verify

```powershell
dsh plugin --profile desktop list
```

Expected: the `cortex` entry is enabled and active. Then open the Cortex panel
and run **Guardian → check**.

## Data

Default data root:

```text
%USERPROFILE%\.dsh\cortex
```

It is separate from any other memory plugin's data. Do not point two memory
plugins at the same SQLite file.

## Upgrade

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-cortex-memory-0.2.0.tgz"
```

Back up the data root before major upgrades:

```powershell
Copy-Item "$env:USERPROFILE\.dsh\cortex" "$env:USERPROFILE\Desktop\cortex-backup" -Recurse
```

## Rollback

1. Disable the `cortex` entry in the DSH plugin manager.
2. Re-enable the previous plugin entry if needed.
3. Restore the profile configuration and data backup.

The plugin never modifies another plugin's data.
