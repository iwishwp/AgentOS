# 真机安装与 M0 验证手册

> 目标：在一台真实的 Linux（Arch/CachyOS 系）机器上装好 niri 会话，逐层验证 `niri-mcp` 的行为与代码假设一致。
> 全程约 40–60 分钟（不含系统安装）。按 L1→L4 逐层放行，任何一层不符先修再进下一层。

## 0. 机器选择

| 路径 | 适用 | 说明 |
|---|---|---|
| **A. 虚拟机冒烟**（推荐先走） | 快速验证 | QEMU/virt-manager 或 VMware：UEFI 启用、virtio-gpu **开启 3D 加速**、内存 ≥ 4G。装一个最小 Arch/CachyOS 即可 |
| B. 物理机/已有系统 | 正式环境 | 已在用 Arch/CachyOS 的机器直接加装 niri 会话，不动现有 DE |

全新 CachyOS 安装：官网下载 ISO → 写盘（`dd` 或 Ventoy）→ 走安装器（桌面选择任意，后面我们用自己的 niri 会话；不装 DE 也行）。

## 1. 安装 niri 会话与依赖

```bash
# 基础会话（Arch/CachyOS 官方仓库；来自 niri 官方文档的快速开始）
sudo pacman -Syu niri xwayland-satellite \
  xdg-desktop-portal-gnome xdg-desktop-portal-gtk \
  alacritty fuzzel

# 开发依赖
sudo pacman -S nodejs npm git
node --version   # 确认 ≥ 20（Arch 源里的 nodejs 远超此版本）

# 可选：Noctalia 桌面 shell（视觉体验，验证不是必需）
# 安装方式见 github.com/noctalia-dev/noctalia
```

启动会话：注销 → TTY 登录 → 运行 `niri-session`（systemd 系统；其他 init 用 `niri --session`）。
若用登录管理器（greetd/SDDM/GDM），选择 Niri 会话即可。

会话内基础键位（官方默认）：`Mod+T` 打开终端（alacritty）、`Mod+D` 启动器（fuzzel）、`Mod+Shift+E` 退出 niri。

> 安全提示（官方文档警告）：从 TTY 直接启动时，niri 退出/崩溃会落在**未锁定的 shell**，正式使用建议配登录管理器。

## 2. 获取本仓库

```bash
# 方式一：GitHub（先把本仓库 push 上去）
git clone <你的仓库地址> ~/AgentOS

# 方式二：从开发机直接同步（无需远端）
# 在 macOS 开发机上执行：
rsync -av --exclude node_modules --exclude dist \
  /Users/demon/codespace/AgentOS/ <user>@<linux机>:~/AgentOS/
```

```bash
cd ~/AgentOS
npm install
npm run build
npm test    # 预期 14 例全绿（不依赖 niri，回归确认）
```

## 3. L1 — 手测 `niri msg`，核对命令签名

在 **niri 会话内**的终端执行（SSH 进来的会话没有 `NIRI_SOCKET`，见排错表）：

```bash
echo $NIRI_SOCKET                      # 应输出一个 socket 路径
niri msg --json windows | head -c 500  # JSON 数组：id/title/app_id/is_focused...
niri msg --json workspaces             # idx/is_active/output_id...
niri msg --json outputs                # 名称/分辨率/逻辑位置...

# 动作类（对照 niri-mcp 的封装）：
niri msg action spawn -- alacritty     # 开一个新终端窗口
niri msg --json windows                # 找到新窗口的 id，下面用 <ID> 代替
niri msg action move-window-to-workspace --id <ID> 2   # 移到工作区 2（不应抢走你的焦点）
niri msg action focus-window --id <ID>                # 前台聚焦
niri msg action focus-workspace 1                     # 回工作区 1
niri msg action close-window --id <ID>                # 关闭
```

核对点：

- `--json` 位于子命令**之前**（我们已按此封装并修过一版）；
- 工作区引用语法：数字索引已确认可用；**名称引用**的写法以
  `niri msg action focus-workspace --help` 的输出为准，与
  `src/niri.ts` 中 `workspaceRef` 的描述不符就改描述；
- `move-window-to-workspace` 默认"焦点跟随移动的窗口"——若要不抢焦点，
  查 `--help` 是否有不带 focus 的选项，需要则升级封装。

任何一条签名与 `packages/niri-mcp/src/niri.ts` 不符 → 修代码 + 测试，`npm test` 保持全绿。

## 4. L2 — MCP server 直连验证（不经 goose）

仍在 niri 会话内的终端：

```bash
cd ~/AgentOS
npx @modelcontextprotocol/inspector node packages/niri-mcp/dist/index.js
```

浏览器打开 inspector，逐个调用 8 个工具：

| 工具 | 预期 |
|---|---|
| `list_windows` / `list_workspaces` / `list_outputs` | 返回 JSON，字段与 L1 手测一致 |
| `open_app` `["alacritty"]` | 屏幕上真的开出终端 |
| `move_window_to_workspace` | 窗口移动、**你当前的输入焦点不被抢** |
| `focus_window` / `focus_workspace` | 视角切换到目标 |
| `close_window` | 目标窗口关闭 |
| 缺参调用（如 `focus_window` 不传 id） | 返回 `isError` 结果，错误信息可读 |

## 5. L3 — goose 端到端

```bash
# 安装 goose（仓库已迁至 aaif-goose/goose）
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash

goose configure   # 先配模型 provider（API key 或现有订阅）
# 挂载 niri-mcp：见 docs/goose-integration.md
goose session
```

对话验收清单（对应 M0 退出标准）：

```
> 列出当前所有窗口                 → 应调用 list_windows 并总结
> 打开 firefox                     → open_app，窗口出现
> 把 firefox 移到第 2 个工作区      → 移动发生，你的焦点仍在原窗口（并发架构的日常可感知验证）
> 切到第 2 个工作区                → 视角切换，看到 firefox
> 关掉 firefox                     → 窗口关闭
```

## 6. L4 — 回填记录

- 与预期不符的行为 → 记录到本文档末尾"实测记录"或开 issue，修复后重跑对应层；
- 通过后：更新 `docs/milestones.md` 中 M0 的完成状态，把 niri 会话安装命令沉淀进
  M5 的安装脚本素材。

## 排错表

| 现象 | 原因与处理 |
|---|---|
| `echo $NIRI_SOCKET` 为空 | 不在 niri 会话内（SSH/TTY 另一会话）。在 niri 内的终端跑；或手动 `export NIRI_SOCKET=$(ls /run/user/$(id -u)/niri.*.socket | head -1)` |
| `无法启动 niri`（isError） | PATH 里没有 niri，用 `NIRI_MSG_BIN=/usr/bin/niri` 指定绝对路径 |
| VM 里 niri 黑屏/崩溃 | 虚拟显卡未开 3D 加速：virtio-gpu + `virtio=gl`（virt-manager 勾选 3D），VMware 开 3D 加速 |
| `niri msg action ...` 参数错 | niri 版本差异，以 `niri msg action <名字> --help` 为准，回修 `src/niri.ts` |
| npm install 慢/失败 | 换镜像：`npm config set registry https://registry.npmmirror.com`（国内环境） |

## 实测记录

- 2026-10-13 文档定稿；官方文档核对：`--json` 在子命令前、`niri-session` 启动方式、`NIRI_SOCKET` 语义均已确认，待真机回填。
