# Publishing

本仓库由发布流程生成，是**发布产物**而不是开发主线；手工改这里的内容会被下一次
发布覆盖。要改行为，改上游源码。

- 仓库：`Lh1314-China/dsh-cortex-memory`
- npm 包：`dsh-cortex-memory`
- 当前版本：以 `package.json` 的 `version` 为准（不要在文档里另写一份）

下面用 `<version>` 表示本次要发的版本号，例如 `0.4.148`。

## 0. 发布前

```powershell
node --version      # 必须 >= 24
npm whoami          # 应为拥有该包的账号
git pull --ff-only  # 工作区干净且与远端一致
```

**版本号四处必须一致**（不一致就不要发）：

```text
package.json          version
README.md             「当前版本」块
CHANGELOG.md          顶部最新一节
安装命令里的版本号
```

## 1. 打包并检查包内容

```powershell
npm pack
```

产出 `dsh-cortex-memory-<version>.tgz`。检查三件事：

```powershell
# 1) 不应该有 test/
tar -tzf dsh-cortex-memory-<version>.tgz | Select-String "^package/test/"

# 2) 文件数与体积（0.4.147 这个包是 135 个文件、328,615 字节；换版本会变）
tar -tzf dsh-cortex-memory-<version>.tgz | Measure-Object

# 3) 包内私词扫描应为 0 命中（扫描器在上游流程里跑，这里做一次抽查）
```

`package.json` 的 `files` 里**不要留 `test`**：`npm pack --dry-run` 的文件数必须
等于发布包的文件数。留了 `test` 会让仓库打出来的包和已发布的包对不上。

## 2. 跑测试

```powershell
node --test test/unit/*.test.js
node --test test/integration/*.test.js
```

CI（`.github/workflows/ci.yml`）在 push 时也会跑这两组，但要发布的那次以本地结果为准。

## 3. 发 npm

```powershell
npm publish dsh-cortex-memory-<version>.tgz --tag latest --access public
npm dist-tag add dsh-cortex-memory@<version> next
```

`latest` 与 `next` 保持同步。发完核对：

```powershell
npm view dsh-cortex-memory dist-tags
```

> 遇到 404 / 409「previously staged version」是 npm 的传播窗口，**不要重发**，
> 等几分钟再看。

## 4. 打 tag 和 GitHub Release

```powershell
git tag v<version>
git push origin v<version>
```

创建 release `v<version>`，上传：

- `dsh-cortex-memory-<version>.tgz`
- `SHA256SUMS.txt`
- `cortex-memory-oneclick-<version>.zip`（Windows 一键包）

`SHA256SUMS.txt` 必须是真实哈希：

```powershell
Get-FileHash dsh-cortex-memory-<version>.tgz -Algorithm SHA256
```

发布后从外网复核一遍（下载资产、比对哈希、确认 SHA256SUMS 对得上）。

**Release 正文要用 UTF-8 字节发送**，不能用 PowerShell 默认编码（中文会变 `?`）：

```powershell
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Uri $uri -Method Patch -Body $bytes `
  -ContentType "application/json; charset=utf-8" -Headers $headers
```

## 5. 装一次

```powershell
dsh plugin --profile desktop add dsh-cortex-memory@<version>
```

## 6. 废弃被取代的旧版本

```powershell
npm deprecate dsh-cortex-memory@<old-range> "old build with local fixtures; use <version> (privacy-cleaned)"
```

只废弃确实有问题的版本；干净的历史版本（例如 `0.4.146`）不要打 deprecated，
否则会把还能用的版本也劝退。

## 配套包

`dsh-cortex-extractors` 与 `dsh-cortex-agency` 是各自独立的仓库和 npm 包，版本号
不跟随主包。README 与安装命令引用它们时，指向当时的实际最新版。

## 不要做

- 不要声称任何不是由这份发布产物跑出来的基准数字。
- 不要在 README / CHANGELOG / package.json 里各改各的版本号。
- 不要在 release 正文里贴没核对过的安装命令（版本号要对得上资产）。
- 不要手工编辑已发布的 npm 包或 release 资产来「修」文档；改文档走下一次发布。
