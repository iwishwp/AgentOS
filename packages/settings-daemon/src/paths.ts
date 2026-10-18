/**
 * paths.ts —— 全部文件路径的单一解析点。
 * 真相仍来自现有文件（noctalia settings.json 的 darkMode、两个色板文件、colors.json），
 * daemon 只做读取映射，不另立竞争真相；状态快照另存 ~/.config/agentos/settings-state.json。
 * 支持 env 覆盖以便测试：AGENTOS_HOME（默认 HOME）、XDG_RUNTIME_DIR。
 */
import { join } from "node:path";

export interface Paths {
  /** ~/.config/noctalia */
  noctaliaDir: string;
  /** 暗色规范板 */
  paletteDark: string;
  /** 浅色规范板 */
  paletteLight: string;
  /** Noctalia 主配置（colorSchemes.darkMode 是变体真相） */
  noctaliaSettings: string;
  /** Noctalia 覆写目标 / 我们的 noctalia 桥输出（watch 事件源） */
  colorsJson: string;
  /** 状态快照（daemon 写，不 watch——避免又一个环） */
  stateFile: string;
  /** 五桥输出 */
  makoConfig: string;
  fuzzelConfig: string;
  ghosttyConfig: string;
  gtk4Css: string;
  gtk3Css: string;
  gtk4Ini: string;
  gtk3Ini: string;
  /** unix socket 降级通道 */
  runtimeDir: string;
  socketPath: string;
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.AGENTOS_HOME ?? env.HOME ?? "/root";
  const runtimeDir = env.XDG_RUNTIME_DIR ?? join("/run/user", String(process.getuid?.() ?? 1000));
  const noctaliaDir = join(home, ".config", "noctalia");
  const agentosDir = join(home, ".config", "agentos");
  return {
    noctaliaDir,
    paletteDark: env.AGENTOS_PALETTE_DARK ?? join(noctaliaDir, "lanrhyme-palette.json"),
    paletteLight: env.AGENTOS_PALETTE_LIGHT ?? join(noctaliaDir, "lanrhyme-palette-light.json"),
    noctaliaSettings: join(noctaliaDir, "settings.json"),
    colorsJson: env.AGENTOS_NOCTALIA_COLORS ?? join(noctaliaDir, "colors.json"),
    stateFile: env.AGENTOS_STATE_FILE ?? join(agentosDir, "settings-state.json"),
    makoConfig: join(home, ".config", "mako", "config"),
    fuzzelConfig: join(home, ".config", "fuzzel", "fuzzel.ini"),
    ghosttyConfig: join(home, ".config", "ghostty", "config"),
    gtk4Css: join(home, ".config", "gtk-4.0", "gtk.css"),
    gtk3Css: join(home, ".config", "gtk-3.0", "gtk.css"),
    gtk4Ini: join(home, ".config", "gtk-4.0", "settings.ini"),
    gtk3Ini: join(home, ".config", "gtk-3.0", "settings.ini"),
    runtimeDir,
    socketPath: join(runtimeDir, "agentos-settings.sock"),
  };
}
