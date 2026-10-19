/**
 * /settings —— AgentOS 自己的系统设置页（外观 / 凭据 / 系统 / 迁移）。
 * 页面骨架沿用 keys-page 的莫兰迪 CSS 变量 + 吸顶模式；数据全部来自 /api/settings/*、
 * /api/credentials（本服务后端再读 daemon 状态文件/起子进程，页面不直接碰系统）。
 * 凭据分区零明文：接口只回引用/标签/通道/存在性/最近使用，页面自然没有明文可显示。
 */
export function settingsPageHtml(colors: Record<string, string>): string {
  const cssVars = Object.entries(colors)
    .map(([k, v]) => `--${k.replace(/_/g, "-")}:${v}`)
    .join(";");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS 设置</title>
<style>
  :root{${cssVars};color-scheme:dark}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--surface);color:var(--on-surface);
    font-family:system-ui,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}
  .topbar{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;
    align-items:center;gap:16px;padding:12px 22px;background:var(--surface);
    border-bottom:1px solid var(--outline-variant)}
  @supports (background:color-mix(in srgb,red 50%,transparent)){
    .topbar{background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(14px)}
  }
  .topbar h1{font-size:16px;margin:0;font-weight:650;letter-spacing:.02em}
  .topbar .sub{font-size:12px;color:var(--on-surface-variant);margin-top:2px}
  .nav{font-size:12.5px;color:var(--on-surface-variant);display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end}
  .nav a{color:var(--primary);text-decoration:none}
  .nav a:hover{text-decoration:underline}
  /* 分区导航：吸在顶栏下，滚动时高亮当前分区 */
  .subnav{position:sticky;top:53px;z-index:15;display:flex;gap:6px;padding:8px 22px;
    background:var(--surface);border-bottom:1px solid var(--outline-variant)}
  @supports (background:color-mix(in srgb,red 50%,transparent)){
    .subnav{background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(12px)}
  }
  .subnav a{padding:6px 14px;border-radius:999px;font-size:13px;text-decoration:none;
    color:var(--on-surface-variant);border:1px solid transparent}
  .subnav a.on{color:var(--on-primary);background:var(--primary);font-weight:600}
  .subnav a:not(.on):hover{border-color:var(--outline-variant)}
  main{max-width:940px;margin:0 auto;padding:20px 20px 64px}
  section.grp{background:var(--surface-container-low);border:1px solid var(--outline-variant);
    border-radius:14px;margin-bottom:18px;scroll-margin-top:110px;overflow:hidden}
  section.grp>h2{margin:0;padding:11px 18px;font-size:13px;font-weight:650;letter-spacing:.08em;
    color:var(--primary);background:var(--surface-container);
    border-bottom:1px solid var(--outline-variant)}
  .pad{padding:14px 18px}
  .hint{font-size:12px;color:var(--on-surface-variant);line-height:1.7}
  /* 外观：模式切换大按钮 */
  .modes{display:flex;gap:12px;margin-bottom:14px}
  .mode{flex:0 0 150px;padding:14px 16px;border-radius:12px;cursor:pointer;text-align:left;
    background:var(--surface-container);border:1px solid var(--outline-variant);color:var(--on-surface);
    font:inherit;font-size:14px;transition:border-color .15s}
  .mode:hover{border-color:var(--primary)}
  .mode.cur{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary) inset}
  .mode .d{display:block;font-size:11.5px;color:var(--on-surface-variant);margin-top:3px}
  /* 状态网格 */
  .kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:6px 0}
  .kv .cell{background:var(--surface-container);border:1px solid var(--outline-variant);
    border-radius:10px;padding:9px 12px}
  .kv .k{font-size:11px;color:var(--on-surface-variant);letter-spacing:.05em}
  .kv .v{font-size:13px;margin-top:3px;word-break:break-all}
  .kv .v.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px}
  /* 状态徽章 */
  .chip{display:inline-flex;align-items:center;gap:5px;padding:2px 10px;border-radius:999px;
    font-size:11.5px;border:1px solid var(--outline-variant);color:var(--on-surface-variant);
    background:var(--surface-container)}
  .chip.ok{color:var(--on-primary);background:var(--secondary-container);border-color:transparent}
  .chip.bad{color:var(--on-error);background:var(--error);border-color:transparent}
  /* 表格（桥/凭据/快照共用） */
  .tblwrap{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th{font-size:11.5px;font-weight:600;color:var(--on-surface-variant);text-align:left;
    padding:7px 10px;letter-spacing:.04em;white-space:nowrap}
  td{padding:7px 10px;border-top:1px solid var(--surface-container-high);vertical-align:top}
  tr:hover td{background:color-mix(in srgb,var(--surface-container) 55%,transparent)}
  code,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px}
  .ref{font-weight:600;word-break:break-all}
  .badges{display:flex;flex-wrap:wrap;gap:4px}
  .badge{font-size:10.5px;padding:1px 8px;border-radius:6px;background:var(--surface-container-highest);
    border:1px solid var(--outline);white-space:nowrap}
  .badge.ch{background:var(--secondary-container);color:var(--on-primary);border-color:transparent}
  .empty{color:var(--on-surface-variant);padding:14px 0;font-size:13px;text-align:center}
  .err{border:1px solid var(--error);color:var(--error);border-radius:10px;
    padding:10px 14px;font-size:12.5px;line-height:1.6;margin-top:10px;display:none;
    background:var(--surface-container-low);word-break:break-all}
  /* 按钮 */
  .btn{appearance:none;border:1px solid var(--outline-variant);border-radius:10px;cursor:pointer;
    background:var(--surface-container);color:var(--on-surface);font:inherit;font-size:13px;
    padding:7px 14px;transition:border-color .15s;white-space:nowrap}
  .btn:hover{border-color:var(--primary)}
  .btn.primary{background:var(--primary);color:var(--on-primary);border-color:transparent;font-weight:600}
  .btn.danger{color:var(--on-error);background:var(--error);border-color:transparent;font-weight:600}
  .btn:disabled{opacity:.5;cursor:wait}
  .rowflex{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0}
  label.ck{font-size:12.5px;color:var(--on-surface-variant);display:inline-flex;gap:6px;align-items:center}
  /* 代码块（注册引导/导入说明） */
  pre.guide{background:var(--surface-container-highest);border:1px solid var(--outline-variant);
    border-radius:10px;padding:12px 14px;font:400 12px/1.7 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    overflow-x:auto;margin:8px 0;white-space:pre}
  pre.guide .c{color:var(--on-surface-variant)}
  /* 吊销确认弹层 */
  .mask{position:fixed;inset:0;background:color-mix(in srgb,var(--surface-dim) 72%,transparent);
    display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .mask.show{display:flex}
  .dlg{max-width:480px;width:100%;background:var(--surface-container-low);
    border:1px solid var(--outline);border-radius:14px;padding:20px 22px;box-shadow:0 18px 48px var(--shadow)}
  .dlg h3{margin:0 0 10px;font-size:15px;color:var(--on-error)}
  .dlg p{font-size:13px;line-height:1.7;margin:0 0 6px}
  .dlg .acts{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
  #toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;display:none;
    background:var(--surface-container-highest);border:1px solid var(--outline);
    color:var(--on-surface);padding:9px 18px;border-radius:999px;font-size:13px;max-width:86vw;
    box-shadow:0 6px 20px var(--shadow)}
  footer{max-width:940px;margin:0 auto;padding:0 20px 36px;font-size:12px;color:var(--outline);line-height:1.8}
</style></head><body>
<div class="topbar">
  <div>
    <h1>AgentOS 设置</h1>
    <div class="sub">canvas /settings · 外观 / 凭据 / 系统 / 迁移</div>
  </div>
  <nav class="nav">
    <a href="/keys">键位</a><a href="/replay">回放</a><a href="/artifacts">产物</a><a href="/">canvas 首页</a>
  </nav>
</div>
<nav class="subnav" id="subnav">
  <a href="#appearance">外观</a><a href="#credentials">凭据</a><a href="#system">系统</a><a href="#migration">迁移</a>
</nav>
<main>

<section class="grp" id="appearance">
  <h2>外观</h2>
  <div class="pad">
    <div class="modes">
      <button class="mode" id="m-dark">暗色<span class="d">lanrhyme 暗色板</span></button>
      <button class="mode" id="m-light">浅色<span class="d">lanrhyme 浅色板</span></button>
    </div>
    <p class="hint">切换经 settings-daemon（D-Bus / unix socket 同一编排器）：状态栏、通知、启动器、终端、GTK 应用同源跟随。切换后本页刷新取新色板。</p>
    <div class="kv" id="app-kv"><div class="cell"><div class="k">状态</div><div class="v">加载中…</div></div></div>
    <div class="err" id="app-err"></div>
  </div>
  <div class="tblwrap"><table id="bridges"><thead><tr><th>桥</th><th>上次应用结果</th></tr></thead><tbody></tbody></table></div>
</section>

<section class="grp" id="credentials">
  <h2>凭据</h2>
  <div class="pad">
    <p class="hint">凭据代理（cred-mcp）的引用清单。明文只存在 Secret Service（keyring）里——本页只显示存在性与策略，任何情况下都取不出、也不显示值。吊销 = 删 keyring 条目 + 摘除策略，agent 立即失去使用权。</p>
    <div class="rowflex" style="justify-content:space-between">
      <span class="hint" id="cred-count"></span>
      <button class="btn" id="cred-refresh">刷新</button>
    </div>
    <div class="err" id="cred-err"></div>
  </div>
  <div class="tblwrap"><table id="creds"><thead><tr>
    <th>引用</th><th>标签</th><th>通道</th><th>exec_allow</th><th>keyring</th><th>最近使用</th><th></th>
  </tr></thead><tbody></tbody></table></div>
  <div class="pad">
    <p class="hint" style="margin:4px 0 0">注册新凭据（终端里跑，明文经 stdin 进 keyring，不落任何日志）：</p>
    <pre class="guide" id="cred-guide"></pre>
    <div class="rowflex"><button class="btn" id="copy-guide">复制注册命令</button>
      <span class="hint">详细语义见 docs/security/credentials.md（通道 A/B/C 与三档白名单）</span></div>
  </div>
</section>

<section class="grp" id="system">
  <h2>系统</h2>
  <div class="pad">
    <p class="hint">AgentOS 守护进程（systemd user 单元）：</p>
    <div class="rowflex" id="units"></div>
    <div class="rowflex" style="margin-top:14px">
      <a class="btn primary" href="/replay" style="text-decoration:none">打开审计时间轴（/replay）</a>
      <span class="hint">凭据使用、吊销、工具放行都会记录在审计日志里</span>
    </div>
  </div>
  <div class="pad" style="border-top:1px solid var(--outline-variant)">
    <div class="rowflex" style="justify-content:space-between">
      <p class="hint" style="margin:0">系统快照（snapper root 配置，agent 系统级变更前的退路）：</p>
      <button class="btn" id="snap-refresh">刷新</button>
    </div>
    <div class="err" id="sys-err"></div>
  </div>
  <div class="tblwrap"><table id="snaps"><thead><tr><th>#</th><th>时间</th><th>描述</th></tr></thead><tbody></tbody></table></div>
</section>

<section class="grp" id="migration">
  <h2>迁移（多机器状态导出/导入）</h2>
  <div class="pad">
    <p class="hint">把本机的 AgentOS 配置（设置状态、权限/凭据策略、niri 配置、色板、goose 配置）打包带走，在新机器上导入。导入是 <b>only-if-absent</b>：已存在的文件一律不覆盖，只出差异报告。</p>
    <div class="rowflex">
      <button class="btn primary" id="export-btn">导出状态包（→ ~/Agent）</button>
      <label class="ck"><input type="checkbox" id="with-secrets"> 连同 goose.env 明文密钥（--with-secrets）</label>
    </div>
    <p class="hint" id="export-out" style="margin:2px 0 0"></p>
    <div class="err" id="mig-err"></div>
  </div>
  <div class="pad" style="border-top:1px solid var(--outline-variant)">
    <p class="hint" style="margin:4px 0 0">在目标机器上导入（先解包看差异，确认后才会真正 only-if-absent 安装）：</p>
    <pre class="guide"><span class="c"># 把状态包拷到新机器后：</span>
~/AgentOS/scripts/agentos-state-import.sh ~/Agent/agentos-state-&lt;主机名&gt;-&lt;时间戳&gt;.tar.gz</pre>
    <div class="rowflex">
      <button class="btn" id="copy-import">复制导入命令</button>
      <span class="hint">goose.env 默认只导出键名模板（值脱敏）；--with-secrets 才带明文，详见 docs/migration.md</span>
    </div>
  </div>
</section>

</main>
<footer>
  外观：settings-daemon（org.agentos.Settings）· 凭据：cred-mcp + Secret Service（零明文纪律）· 系统：systemd user + snapper · 迁移：agentos-state-export/import.sh<br>
  配色来自 Noctalia 系统色板（~/.config/noctalia/colors.json，莫兰迪）· 本页为 canvas 内置页，与 /keys /replay /artifacts 并列
</footer>

<div class="mask" id="mask"><div class="dlg">
  <h3 id="dlg-title">吊销凭据</h3>
  <p id="dlg-body"></p>
  <p>将执行：①删除 keyring 条目 ②摘除 credentials.yaml 策略 ③记审计 credential_revoke。agent 对该引用的使用会立即被拒。</p>
  <div class="acts">
    <button class="btn" id="dlg-cancel">取消</button>
    <button class="btn danger" id="dlg-ok">确认吊销</button>
  </div>
</div></div>
<div id="toast"></div>

<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = (id) => document.getElementById(id);
const fmtTs = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString("zh-CN", {hour12:false}); };
function toast(msg, ms = 2600) { const t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), ms); }
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); }
  if (btn) toast("已复制"); 
}
function showError(id, msg) { const e = $(id); if (!msg) { e.style.display = "none"; return; } e.textContent = msg; e.style.display = "block"; }

// ---------- 外观 ----------
let appData = null;
async function loadAppearance() {
  try {
    const r = await fetch("/api/settings/appearance");
    appData = await r.json();
    renderAppearance();
  } catch (e) { showError("app-err", "状态加载失败: " + e.message); }
}
function renderAppearance() {
  const s = appData && appData.state;
  $("m-dark").classList.toggle("cur", !!(s && s.paletteVariant === "dark"));
  $("m-light").classList.toggle("cur", !!(s && s.paletteVariant === "light"));
  const d = appData && appData.daemon;
  const cells = [
    ["当前变体", s ? s.paletteVariant : "尚未 apply", false],
    ["色板文件", s ? s.palettePath : "—", true],
    ["上次应用", s ? fmtTs(s.lastAppliedAt) + "（" + s.appliedBy + "）" : "—", false],
    ["真相 darkMode（noctalia）", s ? String(s.darkMode) : "—", false],
    ["settings-daemon", d && d.alive ? "运行中（socket Get 应答: " + esc(d.paletteVariant || "?") + "）" : "未运行", false],
  ];
  $("app-kv").innerHTML = cells.map(([k, v, mono]) =>
    '<div class="cell"><div class="k">' + k + '</div><div class="v' + (mono ? " mono" : "") + '">' + esc(v) + "</div></div>").join("");
  const tb = $("bridges").tBodies[0];
  const bridges = s && s.bridges ? Object.entries(s.bridges) : [];
  tb.innerHTML = bridges.length ? bridges.map(([name, st]) => {
    const ok = st === "ok", bad = String(st).startsWith("fail");
    return "<tr><td>" + esc(name) + '</td><td><span class="chip ' + (ok ? "ok" : bad ? "bad" : "") + '">' +
      (ok ? "✓ ok" : bad ? "✗ " + esc(st) : "○ " + esc(st)) + "</span></td></tr>";
  }).join("") : '<tr><td colspan="2" class="empty">（尚无桥状态——还没跑过 apply）</td></tr>';
}
async function applyMode(v) {
  const btn = $("m-" + v);
  for (const b of [$("m-dark"), $("m-light")]) b.disabled = true;
  btn.textContent = "应用中…";
  try {
    const r = await fetch("/api/settings/appearance", {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({variant: v}),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) { showError("app-err", "切换失败: " + (d && d.detail ? d.detail : "HTTP " + r.status)); return; }
    toast("已应用 " + (v === "dark" ? "暗色" : "浅色") + "，刷新取新色板");
    setTimeout(() => location.reload(), 450);
  } catch (e) { showError("app-err", "切换失败: " + e.message); }
  for (const b of [$("m-dark"), $("m-light")]) b.disabled = false;
  $("m-dark").innerHTML = '暗色<span class="d">lanrhyme 暗色板</span>';
  $("m-light").innerHTML = '浅色<span class="d">lanrhyme 浅色板</span>';
}
$("m-dark").addEventListener("click", () => applyMode("dark"));
$("m-light").addEventListener("click", () => applyMode("light"));

// ---------- 凭据 ----------
let credGuide = "";
async function loadCreds() {
  try {
    const r = await fetch("/api/credentials");
    const d = await r.json();
    if (!r.ok) { showError("cred-err", d && d.error ? d.error : "HTTP " + r.status); return; }
    credGuide = d.registerGuide || "";
    $("cred-guide").textContent = credGuide.split("\\n")[0];
    $("cred-count").textContent = (d.credentials || []).length + " 条凭据 · 策略文件 " + (d.policyPath || "");
    const tb = $("creds").tBodies[0];
    tb.innerHTML = (d.credentials || []).length ? d.credentials.map((c) => {
      const kr = c.keyring === null ? '<span class="chip">未知</span>'
        : c.keyring ? '<span class="chip ok">存在</span>' : '<span class="chip bad">缺失</span>';
      return "<tr><td class=\\"ref mono\\">" + esc(c.ref) + "</td><td>" + esc(c.label || "—") + "</td>" +
        '<td><span class="badges">' + (c.allow || []).map((a) => '<span class="badge ch">' + esc(a) + "</span>").join("") + "</span></td>" +
        '<td><span class="badges">' + (c.exec_allow || []).map((x) => '<span class="badge">' + esc(x) + "</span>").join("") + "</span></td>" +
        "<td>" + kr + "</td><td>" + esc(c.lastUsed ? fmtTs(c.lastUsed) : "—") + "</td>" +
        '<td><button class="btn danger" data-ref="' + esc(c.ref) + '">吊销</button></td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">（还没有注册任何凭据）</td></tr>';
    for (const b of tb.querySelectorAll("button[data-ref]"))
      b.addEventListener("click", () => askRevoke(b.dataset.ref));
  } catch (e) { showError("cred-err", "凭据列表加载失败: " + e.message); }
}
let revokeRef = null;
function askRevoke(ref) {
  revokeRef = ref;
  $("dlg-title").textContent = "吊销凭据";
  $("dlg-body").innerHTML = "吊销 <code>" + esc(ref) + "</code>？此操作不可撤销。";
  $("mask").classList.add("show");
}
$("dlg-cancel").addEventListener("click", () => $("mask").classList.remove("show"));
$("mask").addEventListener("click", (e) => { if (e.target === $("mask")) $("mask").classList.remove("show"); });
$("dlg-ok").addEventListener("click", async () => {
  const ref = revokeRef;
  $("mask").classList.remove("show");
  if (!ref) return;
  try {
    const r = await fetch("/api/credentials/revoke", {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({ref}),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) { showError("cred-err", "吊销失败: " + ((d && (d.error || d.keyringError)) || "HTTP " + r.status)); }
    else {
      const parts = [];
      parts.push(d.keyringCleared ? "keyring 已删" : "keyring 未删" + (d.keyringError ? "（" + d.keyringError + "）" : ""));
      parts.push(d.policyRemoved ? "策略已移除" : "策略本就不存在");
      parts.push(d.audited ? "已记审计" : "审计写入失败");
      toast("已吊销 " + ref + " · " + parts.join(" · "), 4200);
    }
    loadCreds();
  } catch (e) { showError("cred-err", "吊销失败: " + e.message); }
});
$("copy-guide").addEventListener("click", (e) => copy(credGuide, e.target));
$("cred-refresh").addEventListener("click", () => { showError("cred-err", ""); loadCreds(); });

// ---------- 系统 ----------
async function loadSystem() {
  try {
    const r = await fetch("/api/settings/system");
    const d = await r.json();
    if (!r.ok) { showError("sys-err", d && d.error ? d.error : "HTTP " + r.status); return; }
    $("units").innerHTML = Object.entries(d.units || {}).map(([u, st]) => {
      const on = st === "active";
      return '<span class="chip ' + (on ? "ok" : "bad") + '">' + (on ? "●" : "○") + " " + esc(u) + "：" + esc(st) + "</span>";
    }).join("");
    renderSnaps(d.snapshots || [], d.snapshotsError);
  } catch (e) { showError("sys-err", "系统状态加载失败: " + e.message); }
}
function renderSnaps(rows, err) {
  const tb = $("snaps").tBodies[0];
  if (err) { showError("sys-err", "快照列表: " + err); }
  tb.innerHTML = rows.length ? rows.slice(0, 30).map((s) =>
    "<tr><td class=\\"mono\\">#" + esc(s.number) + "</td><td>" + esc(fmtTs(s.date)) + "</td><td>" + esc(s.description || "") + "</td></tr>").join("")
    : '<tr><td colspan="3" class="empty">（暂无快照）</td></tr>';
}
$("snap-refresh").addEventListener("click", () => { showError("sys-err", ""); loadSystem(); });

// ---------- 迁移 ----------
$("export-btn").addEventListener("click", async () => {
  const withSecrets = $("with-secrets").checked;
  if (withSecrets && !confirm("勾选了 --with-secrets：goose.env 明文密钥将打进状态包（包权限 600）。
请确认传输通道安全。继续？")) return;
  const btn = $("export-btn");
  btn.disabled = true; btn.textContent = "导出中…";
  try {
    const r = await fetch("/api/settings/migrate/export", {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({withSecrets}),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) { showError("mig-err", "导出失败: " + ((d && d.detail) || "HTTP " + r.status)); $("export-out").textContent = ""; }
    else {
      showError("mig-err", "");
      $("export-out").innerHTML = "已导出：<code>" + esc(d.path || "(见脚本输出)") + "</code>" +
        (d.path ? ' <button class="btn" id="copy-path">复制路径</button>' : "");
      const cp = $("copy-path"); if (cp) cp.addEventListener("click", (e) => copy(d.path, e.target));
      toast("状态包已生成" + (withSecrets ? "（含明文密钥，注意保管）" : ""));
    }
  } catch (e) { showError("mig-err", "导出失败: " + e.message); }
  btn.disabled = false; btn.textContent = "导出状态包（→ ~/Agent）";
});
$("copy-import").addEventListener("click", (e) => copy("~/AgentOS/scripts/agentos-state-import.sh ~/Agent/agentos-state-<主机名>-<时间戳>.tar.gz", e.target));

// ---------- 分区高亮（scrollspy） ----------
const links = [...document.querySelectorAll(".subnav a")];
const secs = links.map((a) => document.querySelector(a.getAttribute("href")));
function spy() {
  let cur = 0;
  for (let i = 0; i < secs.length; i++) {
    if (secs[i].getBoundingClientRect().top < 140) cur = i;
  }
  links.forEach((a, i) => a.classList.toggle("on", i === cur));
}
addEventListener("scroll", spy, {passive: true});

loadAppearance();
loadCreds();
loadSystem();
spy();
</script>
</body></html>`;
}
