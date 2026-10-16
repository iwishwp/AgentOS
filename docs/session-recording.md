# agent 会话录屏与回放（M4）

> 状态：v1 已落地并 VM 实测（2026-10-17）。交付物：`scripts/record-session.sh`（start/stop/status）。
> 这是"回放信任"的地基——用户不盯屏幕也能事后逐段回看 agent 在水族馆里做了什么。

## 1. 设计：录水族馆，不录用户桌面

agent 的所有 GUI 操作发生在嵌套 niri 会话（"水族馆"，见 M3 的 session-mcp）里。录屏对象
**只有水族馆自己的 Wayland 输出**，这带来一个天然的隐私边界：

- 录制进程只连接水族馆的 `WAYLAND_DISPLAY`（如 `wayland-2`），通过 wlr-screencopy 协议
  向**嵌套合成器**请求画面。用户桌面（主 niri 会话，`wayland-1`）在协议层面根本不可见——
  不是"裁剪掉"，而是从未请求；
- 反过来，用户正在看的隐私内容（聊天、密码管理器、浏览器）**物理上不可能**进入录像；
- 录像落 `~/Agent/recordings/<时间戳>.mkv`，与 `~/Agent/screenshots/`、canvas artifacts
  同属 agent 产物目录，天然进入审计/回放体系。

### 什么时候录

- 默认：`agent_session_start` 成功后由 agent（或 systemd 钩子）自动 start，
  `agent_session_stop` 前自动 stop——每个水族馆生命周期对应一个 mkv；
- 手动：用户说"把刚才的操作回放给我看"时，agent 用 status/list 找到对应录像。

### 回放入口设想（v1 未实现）

| 入口 | 形态 |
|---|---|
| canvas 索引页 | `~/Agent/recordings/` 加入 canvas 自动索引，像 screenshots 一样可点开（HTML5 video 播 mkv/VP9 零转码） |
| 审计时间轴对齐 | policy 的 JSONL 审计日志已带毫秒时间戳；录像文件名 `YYYYMMDD-HHMMSS` 为锚，做"第 N 分钟发生了 files__delete"的对照轨 |
| 通知动作 | "查看回放"按钮直接 deep-link 到录像的对应时间点（M2 的动作型通知落地后） |

## 2. 技术选型：调研了什么，为什么是 grim|ffmpeg

### 2.1 gpu-screen-recorder CLI 调研结论

以 [Debian manpage](https://manpages.debian.org/testing/gpu-screen-recorder-cli/gpu-screen-recorder.1.en.html)
+ 本机安装的 6.1.4 `--help` 为准：

| 维度 | 能力 |
|---|---|
| 捕获目标 `-w` | `screen` / `screen-direct`（X11）/ 监视器名（如 `DP-1`，走 **KMS**）/ `portal`（**仅 Wayland**，xdg-desktop-portal + PipeWire 交互选择）/ `region`（配 `-region WxH+X+Y`，兼容 slurp）/ `window`、`focused`（**仅 X11**）/ v4l2 摄像头；多源可用 `\|` 组合并排 |
| 容器/编码 `-c`/`-k` | mp4/mkv/flv/webm；h264/hevc/av1/vp8/vp9（含 HDR/10bit 变体），GPU-only 编码 |
| 分段 | `-df yes`（按日期建目录）；replay 模式 `-r <秒>` 环形缓冲（2–86400s），`-sc <脚本>` 在每次保存后回调（拿文件路径做后处理——**这就是未来的"分段+归档"钩子**） |
| 信号 | SIGINT=停止并保存；SIGUSR1=保存 replay；SIGUSR2=暂停/继续；SIGRTMIN+2..=起停录制 |
| portal 会话复用 | `-restore-portal-session yes`（token 存 `~/.config/gpu-screen-recorder/restore_token`） |

**结论：gpu-screen-recorder 无法只录水族馆**——三条路都封死：

1. KMS 捕获（`screen`/监视器名）只认**物理 DRM 连接器**，与 `WAYLAND_DISPLAY` 无关；
   嵌套 niri 的输出是主会话里的一个窗口，不是 KMS connector，录出来必然是整块物理屏；
2. `portal` 捕获走的是**用户主会话**的 xdg-desktop-portal（单实例，挂在主 niri 上），
   且需要交互式选择显示器——选的也是物理屏，还会打扰用户；
3. `window`/`focused` 仅 X11。

所以 gsr 的定位是**用户主动录整屏**（`--engine gsr`，见下），而非水族馆录制。

### 2.2 本 VM（Fedora 44 aarch64 @ VMware Fusion）实测记录

**成功与失败都记录在案**，失败项同样是结论：

| # | 实验 | 结果 |
|---|---|---|
| 1 | Fedora 官方仓库装 gsr | ❌ 官方源无此包（只有 wf-recorder）。启用 COPR `arabianq/gpu-screen-recorder`（fedora-44-aarch64 有构建），`dnf install gpu-screen-recorder` 装到 **6.1.4** |
| 2 | gsr 在本 VM 起录 | ❌ `gsr error: unknown gpu vendor: VMware, Inc.` / `failed to load opengl`（exit 22）——gsr 只认 AMD/Intel/NVIDIA，VMware SVGA3D 与 llvmpipe（GL_VENDOR 同样报 "VMware, Inc."）都不支持。**gsr 在真机可用 GPU 上才有意义** |
| 3 | wf-recorder（screencopy 系） | ❌ 与 niri 26.04 组合死锁：主会话 wayland-1 与水族馆 wayland-2 **同样**卡死。gdb 栈：主线程阻塞在 `wl_display_dispatch_queue` 等首个 `frame.ready` 事件，SIGINT 无法唤醒（grim 同协议却正常）。版本 wf-recorder 0.6.0-2.fc44 |
| 4 | ffmpeg 编码器 | ⚠️ Fedora 是 ffmpeg-free：无 libx264；**libopenh264 在名单里但 320x240 都建不出编码器**（`Unable to create encoder`，疑似 aarch64 打包问题）；实测可用的是 libvpx-vp9 / libvpx（VP8） |
| 5 | **grim \| ffmpeg 管道（最终方案）** | ✅ `while :; do grim -t ppm -; sleep; done \| ffmpeg -f image2pipe -framerate 8 -c:v libvpx-vp9 out.mkv`。与 session-mcp 截图（grim）同一条 wlr-screencopy 通道，不挑 GPU |
| 6 | 端到端（脚本） | ✅ 见 §4 |

**工程教训（都写进了脚本）**：
- `set -o pipefail` 下 `ffmpeg -encoders \| grep -q xxx` 会因 grep 早退触发 SIGPIPE 而**误判编码器缺失**——必须先捕获输出再 grep；
- 探测编码器不能只看名单，要用 1 帧 lavfi 实测（libopenh264 就是"在名单里但坏着"的例子）；
- **自动探测水族馆 display 的安全默认**：第一版在水族馆不在时回落到了 wayland-1，把用户主会话
  录了 19 秒（已删除、已修复）——教训：没有 `WAYLAND_DISPLAY` 上下文时**拒绝猜测**，
  要求 `--display` 显式指定。信任功能的安全默认必须是"宁可拒绝，不可猜错"。

## 3. 用法

```bash
# 在 agent 上下文里（WAYLAND_DISPLAY=wayland-1 已设置，自动排除主会话、选中水族馆）：
scripts/record-session.sh start [--fps 8]          # 开始录制，输出 ~/Agent/recordings/<时间戳>.mkv
scripts/record-session.sh status                   # 是否在录 + 最近 5 个录像
scripts/record-session.sh stop                     # 优雅停止，打印文件/大小/时长

# 显式指定（裸 SSH 等无环境线索时必需；display 见 agent_session_start 返回）：
scripts/record-session.sh start --display wayland-2

# 用户主动录整块物理屏（需受支持的 GPU：AMD/Intel/NVIDIA；VMware 上不可用）：
scripts/record-session.sh start --engine gsr
```

实现要点：

- **grim 引擎（默认）**：grim 循环 → 命名管道（PPM 原始帧）→ ffmpeg 编码。水族馆被 stop 后
  grim 下一帧失败，循环退出，ffmpeg 读到 EOF 自动写 trailer 收尾——**录像自动终止，无残留进程**；
- 编码器自动探测顺序：libx264 → libopenh264 → libvpx-vp9 → libvpx（1 帧实测后取首个可用）；
- 帧率默认 8fps（审计/回放用途足够，CPU 占用低）；`--fps` 可调；
- 状态文件：`~/Agent/recordings/.recorder.{pid,out,log,ffmpeg.pid,fifo}`，stop 后清理；
- 依赖：grim（session-mcp 已依赖）+ ffmpeg（Fedora 自带 ffmpeg-free 即可）。gsr 引擎额外需要
  `dnf copr enable arabianq/gpu-screen-recorder && dnf install gpu-screen-recorder`。

## 4. VM 验证结论（2026-10-17）

```text
$ WAYLAND_DISPLAY=wayland-1 scripts/record-session.sh start --fps 8
录制中: /home/demon/Agent/recordings/20261016-212542.mkv
  引擎=grim 编码器=libvpx-vp9 目标=wayland-2 fps=8
$ scripts/record-session.sh stop
已停止: /home/demon/Agent/recordings/20261016-212542.mkv（49K，时长 6.625000s）
$ ffprobe -show_entries stream=codec_name,width,height,avg_frame_rate ...
vp9 / 1015x1378 / 8/1            # 尺寸=水族馆输出（主屏是 2070x1466——边界成立）
```

- 嵌套 niri（`WAYLAND_DISPLAY=wayland-1 setsid niri &`，实测自动分配 wayland-2 + 独立 IPC socket）
  起停两个周期，录制均为有效可播放 mkv（ffprobe 全字段通过，vp9 8fps）；
- 失败路径逐条验证：水族馆未起（友好报错并指引 agent_session_start）、裸环境自动探测
  （拒绝并要求 --display）、gsr 引擎在 VMware（打印 gsr 原始错误并中止）；
- 验证后嵌套 niri 与录制进程全部清理，主会话 niri（pid 39307）未受影响。

## 5. 遗留事项

- [ ] fps 上限：grim 每帧全量 PPM（1015x1418 ≈ 4.3MB）经管道，实测 8fps 稳定；更高帧率在
      低端机上的瓶颈待真机评估（gsr 的 GPU 编码正是为此，但见 §2.1 的边界限制）；
- [ ] 分段与保留策略：gsr 的 `-r` replay + `-sc` 回调已调研，grim 路线的等价物（按大小/时长
      切文件 + 保留 N 天）待做；
- [ ] 音频：水族馆暂无音频通道，故 v1 无 `-a`；将来若水族馆接 PipeWire 音频，wf-recorder/gsr
      均支持，grim 路线可加 ffmpeg 第二输入；
- [ ] 回放入口：§1 的 canvas 索引 + 审计时间轴对齐，待 M4 审计日志结构定稿后实现；
- [ ] gsr 引擎在真机（AMD/Intel/NVIDIA）上的验证——本 VM 的 GPU 不受支持，无法验证。
