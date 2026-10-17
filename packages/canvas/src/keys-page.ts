import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Noctalia 色板（莫兰迪，source #eee6ba）部署位；可用 AGENTOS_COLORS_JSON 覆盖 */
export const DEFAULT_COLORS_JSON = path.join(os.homedir(), ".config", "noctalia", "colors.json");

/**
 * 缺省降级色板：与 os/configs/noctalia/lanrhyme/colors.json 同值。
 * colors.json 不在（如非部署机）时页面仍按莫兰迪渲染，只是不随系统换肤。
 */
const FALLBACK_COLORS: Record<string, string> = {
  surface: "#21201c",
  on_surface: "#f3f3f2",
  surface_dim: "#161613",
  surface_container_lowest: "#11100e",
  surface_container_low: "#1c1b17",
  surface_container: "#37362f",
  surface_container_high: "#32312a",
  surface_container_highest: "#3d3b34",
  on_surface_variant: "#b5b4b0",
  outline: "#6b6a63",
  outline_variant: "#6c6a61",
  primary: "#dad8ce",
  on_primary: "#22211c",
  secondary_container: "#898d68",
  error: "#fd4663",
  on_error: "#22211c",
  shadow: "#21201c",
};

/** 页面实际使用的 Material 键（白名单；其余 50+ 键不进 CSS 变量） */
const COLOR_KEYS = Object.keys(FALLBACK_COLORS);

/**
 * colors.json → CSS 变量表。文件缺失/坏 JSON/非法色值一律降级到缺省值，
 * 键名 snake_case → CSS 的 kebab-case 由模板侧完成。
 */
export function loadColors(file: string): Record<string, string> {
  const out = { ...FALLBACK_COLORS };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const k of COLOR_KEYS) {
      const v = parsed[k];
      if (typeof v === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) {
        out[k] = v.toLowerCase();
      }
    }
  } catch {
    // 缺省降级：色板文件不该让页面 500
  }
  return out;
}

/**
 * /keys 键位速查页（自包含 HTML，无外部依赖；数据来自 /api/keys 实时解析）。
 * Omarchy 心智：内容多于一屏是常态，整页上下滚动 + 分组标题吸顶 + 右上过滤框。
 */
export function keysPageHtml(colors: Record<string, string>): string {
  const cssVars = Object.entries(colors)
    .map(([k, v]) => `--${k.replace(/_/g, "-")}:${v}`)
    .join(";");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS 键位速查</title>
<style>
  :root{${cssVars};color-scheme:dark}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--surface);color:var(--on-surface);
    font-family:system-ui,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}
  /* 顶栏：标题 + 过滤框，吸顶；支持 color-mix 时做半透明毛玻璃（与 Noctalia 桌面同气） */
  .topbar{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;
    align-items:center;gap:16px;padding:12px 22px;background:var(--surface);
    border-bottom:1px solid var(--outline-variant)}
  @supports (background:color-mix(in srgb,red 50%,transparent)){
    .topbar{background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(14px)}
  }
  .topbar h1{font-size:16px;margin:0;font-weight:650;letter-spacing:.02em}
  .topbar .sub{font-size:12px;color:var(--on-surface-variant);margin-top:2px}
  #filter{background:var(--surface-container-high);border:1px solid var(--outline-variant);
    color:var(--on-surface);border-radius:999px;padding:8px 16px;font-size:13px;width:230px;
    outline:none;transition:border-color .15s}
  #filter:focus{border-color:var(--primary)}
  #filter::placeholder{color:var(--outline)}
  main{max-width:940px;margin:0 auto;padding:20px 20px 48px}
  .count{font-size:12px;color:var(--on-surface-variant);margin:0 4px 12px}
  /* 分组卡片：标题吸在顶栏下方，滚到哪节都看得见自己在哪节 */
  .grp{background:var(--surface-container-low);border:1px solid var(--outline-variant);
    border-radius:14px;margin-bottom:18px}
  .grp h2{position:sticky;top:53px;z-index:5;margin:0;padding:11px 18px;font-size:13px;
    font-weight:650;letter-spacing:.08em;color:var(--primary);
    background:var(--surface-container);border-bottom:1px solid var(--outline-variant);
    border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center}
  .grp h2 .n{font-size:11px;color:var(--on-surface-variant);font-weight:400;letter-spacing:0}
  .row{display:grid;grid-template-columns:225px 1fr;gap:14px;align-items:center;
    padding:9px 18px;border-top:1px solid var(--surface-container-high)}
  .grp .row:first-of-type{border-top:none}
  .keys{display:flex;flex-wrap:wrap;align-items:center;gap:4px;justify-content:flex-start}
  /* 键帽：底边加厚 + 轻投影，实体键帽观感 */
  kbd{display:inline-block;padding:3px 8px;border-radius:6px;font:600 12px/1.5 ui-monospace,
    "SF Mono",Menlo,Consolas,monospace;background:var(--surface-container-highest);
    color:var(--on-surface);border:1px solid var(--outline);border-bottom-width:3px;
    box-shadow:0 1px 2px var(--shadow);white-space:nowrap}
  kbd.mod{border-color:var(--secondary-container)} /* 修饰键微强调（莫兰迪橄榄） */
  .plus{color:var(--outline);font-size:11px;font-weight:600}
  .t{font-size:13.5px;line-height:1.45}
  .a{font:400 11.5px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    color:var(--on-surface-variant);margin-top:2px;word-break:break-all}
  .empty{color:var(--on-surface-variant);text-align:center;padding:40px 0;font-size:14px}
  .err{border:1px solid var(--error);color:var(--error);border-radius:12px;
    padding:14px 18px;font-size:13px;line-height:1.6;margin-top:20px;background:var(--surface-container-low)}
  footer{max-width:940px;margin:0 auto;padding:0 20px 36px;font-size:12px;
    color:var(--outline);line-height:1.8}
  @media (max-width:640px){.row{grid-template-columns:1fr;gap:6px}}
</style></head><body>
<div class="topbar">
  <div>
    <h1>AgentOS 键位速查</h1>
    <div class="sub">Super+K · 实时解析 ~/.config/niri/config.kdl</div>
  </div>
  <input id="filter" placeholder="过滤键位/功能…（按 / 聚焦）" autocomplete="off">
</div>
<main>
  <p class="count" id="count"></p>
  <div id="sections"><p class="empty">加载中…</p></div>
</main>
<footer>
  滚动查看全部分组 · 输入即过滤 · Esc 清空 · 内置兜底：<kbd>Mod</kbd><span class="plus">+</span><kbd>Shift</kbd><span class="plus">+</span><kbd>/</kbd>（niri hotkey overlay，canvas 服务不可用时用）<br>
  配色来自 Noctalia 系统色板（~/.config/noctalia/colors.json，莫兰迪）· 数据源即 niri 配置本身，改键位本页自动跟随
</footer>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MODS = new Set(["Super","Mod","Ctrl","Alt","Shift","Print","Tab","Return","Escape","Delete"]);
const keycap = (keys) => keys.split("+").map((k) =>
  '<kbd' + (MODS.has(k) ? ' class="mod"' : '') + '>' + esc(k) + '</kbd>').join('<span class="plus">+</span>');

async function load() {
  const box = document.getElementById("sections");
  let data;
  const r = await fetch("/api/keys");
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok || !Array.isArray(data)) {
    const msg = data && data.error ? data.error : ("HTTP " + r.status);
    box.innerHTML = '<div class="err">键位数据加载失败：' + esc(msg) +
      '<br>内置兜底：按 <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>/</kbd> 打开 niri 自带速查浮层。</div>';
    document.getElementById("count").textContent = "";
    return;
  }
  render(data, "");
  document.getElementById("filter").addEventListener("input", (e) => render(data, e.target.value.trim().toLowerCase()));
  document.addEventListener("keydown", (e) => {
    const f = document.getElementById("filter");
    if (e.key === "/" && document.activeElement !== f) { e.preventDefault(); f.focus(); }
    if (e.key === "Escape" && document.activeElement === f) { f.value = ""; render(data, ""); f.blur(); }
  });
}

function render(sections, q) {
  const box = document.getElementById("sections");
  let shown = 0, total = 0;
  const html = sections.map((s) => {
    const rows = s.binds.filter((b) => !q ||
      b.title.toLowerCase().includes(q) || b.action.toLowerCase().includes(q) ||
      b.keys.toLowerCase().includes(q));
    total += s.binds.length;
    if (!rows.length) return "";
    shown += rows.length;
    return '<section class="grp"><h2>' + esc(s.section) +
      '<span class="n">' + rows.length + '</span></h2>' +
      rows.map((b) => '<div class="row"><div class="keys">' + keycap(b.keys) + '</div>' +
        '<div><div class="t">' + esc(b.title) + '</div><div class="a">' + esc(b.action) + '</div></div></div>').join("") +
      '</section>';
  }).join("");
  box.innerHTML = html || '<p class="empty">（无匹配键位）</p>';
  document.getElementById("count").textContent = q ? (shown + " / " + total + " 个键位") : (total + " 个键位 · " + sections.length + " 个分组");
}
load();
</script>
</body></html>`;
}
