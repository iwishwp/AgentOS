// AgentOS 键位速查浮层（qs -c agentos-hotkeys）
//
// Omarchy/niri 原生心智：按 Super+K 顶部弹出近全宽浮层；本实现是 layer-shell
// 覆盖层（不是应用窗口）：全屏透明层 + 顶部面板，点任意处或按 Esc 关闭
//（进程即退，无常驻）。行式仿 Omarchy Keybindings：纯文本键列（大写等宽，
// "SUPER SHIFT + F" 形态）左对齐，说明从固定列起始、"→" 分隔，无键帽芯片。
//
// 数据零副本：启动时解析 niri 配置的 binds 段（AGENTOS_NIRI_CONFIG 可覆盖路径），
// 分组沿用配置里的 "// ==== X ====" 注释；标题取 hotkey-overlay-title，缺省用动作名。
// 配色零副本：读 ~/.config/noctalia/colors.json（AGENTOS_COLORS_JSON 可覆盖），
// 缺省退化为内置莫兰迪同值色板。
//
// 调试：AGENTOS_HOTKEYS_DUMP=1 时不弹窗，只把解析结果打到 stderr 后退出。

import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick

ShellRoot {
  id: root

  // ---- 莫兰迪色板（colors.json 缺失时的兜底 = 仓库 lanrhyme/colors.json 同值） ----
  readonly property var fallbackColors: ({
    "surface": "#21201c", "on_surface": "#f3f3f2",
    "surface_container": "#37362f", "surface_container_high": "#32312a",
    "surface_container_highest": "#3d3b34", "on_surface_variant": "#b5b4b0",
    "outline": "#6b6a63", "outline_variant": "#6c6a61", "primary": "#dad8ce"
  })
  property var colors: fallbackColors

  // 十六进制色 → 指定透明度的 Qt.rgba（配色仍实时来自 colors.json，只叠 alpha）
  function withAlpha(hex, a) {
    const h = String(hex).replace("#", "");
    return Qt.rgba(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255, a);
  }

  // 键串 → Omarchy 形态的显示文本："Super+Shift+Return" → "SUPER SHIFT + RETURN"
  //（只改渲染：修饰键空格分隔，仅最后一个键前加 " + "；滚轮 * 后缀剥掉）
  function comboText(keys) {
    const parts = String(keys).replace(/\*+$/, "").split("+")
      .map(p => p.trim().toUpperCase());
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(" ") + " + " + parts[parts.length - 1];
  }

  // ---- 解析 niri 配置 → [{title, binds:[{keys,title}]}] ----
  property var groups: []

  function parseConfig(text) {
    const out = [];
    let cur = null;
    let inBinds = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!inBinds) {
        if (/^binds\s*\{/.test(line)) inBinds = true;
        continue;
      }
      if (line === "}") { inBinds = false; continue; }
      if (line.startsWith("//")) {
        const m = line.match(/^\/\/\s*=+\s*(.+?)\s*=+\s*$/);
        if (m) { cur = { title: m[1], binds: [] }; out.push(cur); }
        continue;
      }
      // 键名允许 *（滚轮）、后随 0..n 个内联参数（如 allow-inhibiting=false）
      const m = line.match(/^([A-Za-z0-9]+(?:\+[A-Za-z0-9*]+)*\*?)\s+(?:[A-Za-z-]+=[^\s"]+\s+)*(?:hotkey-overlay-title="([^"]*)"\s+)?\{(.*)$/);
      if (m) {
        if (!cur) { cur = { title: "其他", binds: [] }; out.push(cur); }
        let title = m[2] || "";
        if (!title) {
          const act = (m[3] || "").replace(/[;}\s]+$/, "").trim();
          title = act.length > 44 ? act.slice(0, 44) + "…" : act;
        }
        cur.binds.push({ keys: m[1], title: title });
      }
    }
    return out;
  }

  // 注：此版 quickshell 的 FileView.text 是同步读方法（非属性），在 completed 里取
  Component.onCompleted: {
    try {
      root.groups = root.parseConfig(cfgView.text());
    } catch (e) {
      console.error("[hotkeys] 读/解析 niri 配置失败: " + e);
      Qt.quit();
    }
    const n = root.groups.reduce((s, g) => s + g.binds.length, 0);
    console.warn("[hotkeys] 分组 " + root.groups.length + " / 键位 " + n);
    if (Quickshell.env("AGENTOS_HOTKEYS_DUMP")) {
      for (const g of root.groups) {
        console.warn("[hotkeys] == " + g.title + " (" + g.binds.length + ")");
        for (const b of g.binds.slice(0, 3))
          console.log("[hotkeys]   " + b.keys + "  " + b.title);
      }
      Qt.quit();
    }
    try {
      const c = JSON.parse(colView.text());
      root.colors = Object.assign({}, root.fallbackColors, {
        "surface": c.surface, "on_surface": c.on_surface,
        "surface_container": c.surface_container,
        "surface_container_high": c.surface_container_high,
        "surface_container_highest": c.surface_container_highest,
        "on_surface_variant": c.on_surface_variant,
        "outline": c.outline, "outline_variant": c.outline_variant,
        "primary": c.primary
      });
    } catch (e) { console.warn("[hotkeys] colors.json 不可用，用兜底色板: " + e); }
  }

  FileView {
    id: cfgView
    // blockLoading=true：text() 同步返回内容（否则只触发异步读，拿到空串）
    blockLoading: true
    path: Quickshell.env("AGENTOS_NIRI_CONFIG")
          || (Quickshell.env("HOME") + "/.config/niri/config.kdl")
    watchChanges: false
  }

  FileView {
    id: colView
    blockLoading: true
    path: Quickshell.env("AGENTOS_COLORS_JSON")
          || (Quickshell.env("HOME") + "/.config/noctalia/colors.json")
    watchChanges: false
  }

  Variants {
    model: Quickshell.screens

    delegate: PanelWindow {
      id: win

      required property ShellScreen modelData
      screen: modelData

      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"

      WlrLayershell.namespace: "agentos-hotkeys-" + (modelData?.name || "unknown")
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
      WlrLayershell.exclusionMode: ExclusionMode.Ignore

      // ---- 全屏点按关闭 + Esc 关闭 ----
      Item {
        anchors.fill: parent
        focus: true
        Keys.onEscapePressed: Qt.quit()

        // 轻压暗（Omarchy 式：壁纸原色可见，只稍微聚焦；点按即关）
        Rectangle { anchors.fill: parent; color: "#000000"; opacity: 0.15 }
        MouseArea { anchors.fill: parent; onClicked: Qt.quit() }

        // ---- 近全宽顶部面板（Omarchy 形态：顶部悬浮、近直角、半透明、超高滚动） ----
        Rectangle {
          id: panel
          // 尺寸绑 screen（创建瞬间 contentItem 可能未定型，绑 parent.width 会得负值）
          readonly property real panelWidth: (win.screen?.width ?? 1280) - 48
          readonly property real maxH: (win.screen?.height ?? 800) - 80
          readonly property real contentH: Math.min(view.contentHeight + 96, maxH)

          width: panelWidth
          height: contentH
          // Omarchy 心智：顶部居中（状态栏下方），非屏幕正中
          anchors.horizontalCenter: parent.horizontalCenter
          anchors.top: parent.top
          anchors.topMargin: 40
          radius: 2
          color: root.withAlpha(root.colors.surface_container, 0.88)
          border.width: 1
          border.color: root.withAlpha(root.colors.outline_variant, 0.5)

          // 面板本体拦截点按（点内容不穿透关闭，避免误触；点面板外关闭）
          MouseArea { anchors.fill: parent; onClicked: {} }

          Column {
            anchors.fill: parent
            anchors.margins: 24
            spacing: 36

            // 标题：小号、常规字重、灰（Omarchy "Keybindings" 的层级：弱于正文）
            Text {
              text: "键位速查"
              color: root.colors.on_surface_variant
              opacity: 0.75
              font.pixelSize: 11
              font.weight: Font.Normal
              font.family: "monospace"
            }

            ListView {
              id: view
              width: parent.width
              height: parent.height - 47
              clip: true
              interactive: true
              spacing: 8

              model: {
                const rows = [];
                for (const g of root.groups) {
                  rows.push({ type: "h", text: g.title });
                  for (const b of g.binds) rows.push({ type: "b", keys: b.keys, title: b.title });
                }
                return rows;
              }

              delegate: Item {
                required property var modelData
                width: view.width
                height: modelData.type === "h" ? 40 : 34

                // 分组标题：常规字重小灰字 + 上方留白（Omarchy 无分组，取其标题区的弱化语感）
                Text {
                  visible: modelData.type === "h"
                  text: modelData.text ?? ""
                  color: root.colors.on_surface_variant
                  opacity: 0.6
                  font.pixelSize: 11
                  font.weight: Font.Normal
                  anchors.left: parent.left
                  anchors.top: parent.top
                  anchors.topMargin: 18
                }

                // 行：键左列（左对齐、右参差），说明全部从固定 x 起始，"→" 分隔（Omarchy 行式）
                Item {
                  visible: modelData.type === "b"
                  anchors.fill: parent

                  Text {
                    id: keysText
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.type === "b" ? root.comboText(modelData.keys) : ""
                    color: root.colors.primary
                    font.pixelSize: 17
                    font.family: "monospace"
                  }

                  Text {
                    anchors.left: parent.left
                    anchors.leftMargin: Math.round(parent.width * 0.45)
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.type === "b" ? "→  " + (modelData.title ?? "") : ""
                    color: root.colors.on_surface
                    font.pixelSize: 17
                    font.family: "monospace"
                    elide: Text.ElideRight
                  }
                }
              }

              // 键盘上下翻页（Omarchy 的"可上下翻动"）
              Keys.onPressed: event => {
                if (event.key === Qt.Key_PageDown || event.key === Qt.Key_Down) {
                  view.contentY = Math.min(view.contentY + 200, view.contentHeight - view.height);
                  event.accepted = true;
                } else if (event.key === Qt.Key_PageUp || event.key === Qt.Key_Up) {
                  view.contentY = Math.max(view.contentY - 200, 0);
                  event.accepted = true;
                }
              }
            }
          }
        }
      }
    }
  }
}
