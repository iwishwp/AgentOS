/**
 * daemon.ts —— 常驻进程：watchers（事件源）→ 编排器（apply）→ 状态/D-Bus。
 * 事件源三路（全部环保护，见 hub.ts）：
 *   a) colors.json        —— Noctalia 暗/亮切换会**覆写**它，这就是主事件源；
 *                            我们自己的 noctalia 桥也写它 → 哈希环保护吞回声
 *   b) noctalia settings.json —— 只认 colorSchemes.darkMode 真值变化
 *   c) 两个色板文件        —— 换壁纸重生成色板后自动跟随
 * 启动即收敛一次（startup apply），之后纯事件驱动；重入合并（应用中的新事件只补跑一轮）。
 */
import { ShellRunner, type CommandRunner } from "@agentos/proc";
import { defaultPaths, type Paths } from "./paths.js";
import { WatchHub } from "./hub.js";
import { applyTheme } from "./apply.js";
import { parseDarkMode, loadState } from "./state.js";
import { readTextIfExists } from "./fsutil.js";
import { serveIpc, type IpcServer } from "./ipc.js";
import type { Variant } from "./palette.js";

export interface DaemonOptions {
  debounceMs?: number;
  runner?: CommandRunner;
  paths?: Paths;
  /** 测试钩子：startup apply 完成后调用 */
  onReady?: () => void;
}

function ts(): string {
  return new Date().toISOString();
}

export async function runDaemon(opts: DaemonOptions = {}): Promise<void> {
  const paths = opts.paths ?? defaultPaths();
  const runner = opts.runner ?? new ShellRunner();
  const hub = new WatchHub({
    debounceMs: opts.debounceMs ?? 250,
    onDebug: (m) => console.log(`[${ts()}] [watch] ${m}`),
  });
  const log = (line: string) => console.log(`[${ts()}] ${line}`);

  let lastDarkMode = parseDarkMode(await readTextIfExists(paths.noctaliaSettings));
  let lastVariant: Variant = lastDarkMode ? "dark" : "light";

  // ---- 应用队列：in-flight 合并（应用期间来的新事件只补跑一轮）----
  let inFlight: Promise<void> | null = null;
  let queued: { reason: string; variant: "auto" | Variant } | null = null;

  async function doApply(reason: string, variant: "auto" | Variant): Promise<void> {
    try {
      const r = await applyTheme(
        { runner, paths, hub, logger: log },
        { variant, reason, appliedBy: "daemon" },
      );
      lastVariant = r.variant;
      log(
        `应用完成（${reason}）→ ${r.variant} 档：` +
          r.bridges.map((b) => `${b.ok ? "✓" : "✗"}${b.name}${b.changed ? "(写)" : "(同)"}`).join(" "),
      );
      ipc?.emitChanged(r.variant);
    } catch (e) {
      log(`应用失败（${reason}）：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function runApply(reason: string, variant: "auto" | Variant = "auto"): Promise<void> {
    if (inFlight) {
      log(`事件合并（${reason}）——当前应用完成后补跑一轮`);
      queued = { reason, variant };
      return inFlight;
    }
    inFlight = doApply(reason, variant).finally(() => {
      inFlight = null;
      if (queued) {
        const q = queued;
        queued = null;
        void runApply(`${q.reason}（补跑）`, q.variant);
      }
    });
    return inFlight;
  }

  // ---- IPC（dbus + socket；Changed 信号在每次成功应用后广播）----
  const ipc: IpcServer = await serveIpc(
    {
      getDarkMode: () => lastDarkMode,
      getPaletteVariant: () => lastVariant,
      apply: (v) => runApply(`ipc Apply(${v})`, v === "dark" || v === "light" ? v : "auto").then(() => ({ ok: true })),
      reload: () => runApply("ipc Reload()").then(() => ({ ok: true })),
    },
    paths.socketPath,
  );
  log(`IPC 就绪：transport=${ipc.transport}，socket=${paths.socketPath}`);

  // ---- watchers ----
  hub.watch(paths.colorsJson, () => void runApply("colors.json 变更（Noctalia 覆写即事件源）"));
  hub.watch(paths.noctaliaSettings, () => {
    void (async () => {
      const dm = parseDarkMode(await readTextIfExists(paths.noctaliaSettings));
      if (dm !== lastDarkMode) {
        log(`settings.json darkMode: ${lastDarkMode} → ${dm}`);
        lastDarkMode = dm;
        await runApply(`darkMode=${dm}`);
      }
    })();
  });
  hub.watch(paths.paletteDark, () => void runApply("暗色板变更（换壁纸重生成）"));
  hub.watch(paths.paletteLight, () => void runApply("浅色板变更"));

  // ---- 启动收敛 ----
  const state = await loadState(paths.stateFile);
  log(
    `agentos-settings daemon 启动（state.lastAppliedAt=${state?.lastAppliedAt ?? "无"}，darkMode=${lastDarkMode}）`,
  );
  await runApply("startup");
  opts.onReady?.();

  // ---- 优雅退出 ----
  const stop = async () => {
    log("退出：关闭 watchers 与 IPC");
    await hub.stopAll();
    await ipc.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());

  // ---- 前台常驻 ----
  await new Promise<void>(() => {});
}
