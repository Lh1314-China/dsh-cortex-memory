# Publishing

This repository is prepared for a first public release. Fill in the repository
URL in `package.json` before pushing.

## 1. Create the GitHub repository

```powershell
git init
git add .
git commit -m "feat: initial public release"
git branch -M main
git remote add origin https://github.com/<your-name>/dsh-cortex-memory.git
git push -u origin main
```

## 2. Build the installable package

```powershell
npm pack
```

This produces `dsh-cortex-memory-0.1.0.tgz`. This is the DSH-installable
artifact. A GitHub source zip is **not** the same thing; DSH expects the npm
tgz (or a package name).

## 3. GitHub release

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Create a release named `v0.1.0` and upload:

- `dsh-cortex-memory-0.1.0.tgz`
- `SHA256SUMS.txt`

Install from the release:

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-cortex-memory-0.1.0.tgz"
```

## 4. npm (optional)

```powershell
npm login
npm publish --access public
```

If npm rejects the name, publish as a scoped package:

```powershell
npm pkg set name="@<your-name>/dsh-cortex-memory"
npm publish --access public
```

Then the install command becomes:

```powershell
dsh plugin --profile desktop add @<your-name>/dsh-cortex-memory
```

## 5. Submit to the DSH directory

Submit the GitHub repository or npm package at the DSH plugin directory. Do not
claim benchmark numbers that were not produced by the published artifact.
