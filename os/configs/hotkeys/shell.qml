// AgentOS 键位速查浮层（qs -c agentos-hotkeys）
//
// 形态（Omarchy 参考的悬浮卡片口径，非全屏）：顶部居中、状态栏下方留间距、
// 四周见壁纸的圆角卡片——宽度约屏宽一半、高度克制（内容不足则收短，超出
// 则内部滚动）。layer-shell 覆盖层（不是应用窗口）：全屏透明层 + 轻压暗，
// 点任意处或按 Esc 关闭（进程即退，无常驻）。
// 行式仿 Omarchy Keybindings：键列（大写等宽，"SUPER SHIFT + F" 形态）左对齐，
// 说明从固定列起始、"→" 分隔，无键帽芯片。
//
// 卡片语言与系统同族（对齐 mako/状态栏档位）：圆角 12 / 描边 2px
// outline_variant / 底 surface_container（~93% 不透明）。
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

        // 键盘：Esc 关闭；↑↓/PgUp/PgDn 翻动列表（Omarchy 的"可上下翻动"）。
        // 焦点在整个覆盖层（ListView 自身无焦点），翻页统一操作 view.contentY
        Keys.onPressed: event => {
          if (event.key === Qt.Key_Escape) {
            Qt.quit();
          } else if (event.key === Qt.Key_PageDown || event.key === Qt.Key_Down) {
            view.contentY = Math.min(view.contentY + 200,
              view.contentHeight - view.height);
            event.accepted = true;
          } else if (event.key === Qt.Key_PageUp || event.key === Qt.Key_Up) {
            view.contentY = Math.max(view.contentY - 200, 0);
            event.accepted = true;
          }
        }

        // 轻压暗（Omarchy 式：壁纸原色可见，只稍微聚焦；点按即关）
        Rectangle { anchors.fill: parent; color: "#000000"; opacity: 0.15 }
        MouseArea { anchors.fill: parent; onClicked: Qt.quit() }

        // ---- 顶部居中悬浮卡片（Omarchy 形态：四周见壁纸、宽度克制、圆角卡片） ----
        Rectangle {
          id: panel

          // 卡片几何（Omarchy 参考比例：宽约半屏、高≤68% 屏高、顶部栏下留间距）
          readonly property real topGap: 64          // 状态栏(37px)下留 27px
          readonly property real panelWidth: Math.min(
            Math.round((win.screen?.width ?? 1280) * 0.5), 680)
          readonly property real maxH: Math.min(
            Math.round((win.screen?.height ?? 800) * 0.68),
            (win.screen?.height ?? 800) - topGap - 40)
          // 面板内固定装饰高：上下边距 + 标题区 + 标题下间距 + 底部提示区
          readonly property real chromeH: 24 * 2 + 18 + 12 + 36
          readonly property real cardH: Math.min(view.contentHeight + chromeH, maxH)

          width: panelWidth
          height: cardH
          anchors.horizontalCenter: parent.horizontalCenter
          anchors.top: parent.top
          anchors.topMargin: topGap
          radius: 12

          // 柔影近似：卡片下垫一块略下移的半透明黑块（参考图有极淡投影）
          Rectangle {
            z: -1
            width: panel.width
            height: panel.height
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.topMargin: 10
            radius: 14
            color: root.withAlpha("#000000", 0.30)
          }
          color: root.withAlpha(root.colors.surface_container, 0.93)
          border.width: 2
          border.color: root.colors.outline_variant

          // 卡片本体拦截点按（点内容不穿透关闭，避免误触；点卡片外关闭）
          MouseArea { anchors.fill: parent; onClicked: {} }

          Column {
            anchors.fill: parent
            anchors.margins: 24
            spacing: 0

            // 标题：小号、常规字重、灰（Omarchy "Keybindings" 的层级：弱于正文）
            Text {
              text: "键位速查"
              color: root.colors.on_surface_variant
              opacity: 0.8
              font.pixelSize: 12
              font.weight: Font.Normal
              font.family: "Noto Sans CJK SC"
              height: 18
            }

            Item { width: parent.width; height: 12 }

            ListView {
              id: view
              width: parent.width
              height: panel.cardH - panel.chromeH
              clip: true
              interactive: true
              spacing: 4
              boundsBehavior: Flickable.StopAtBounds

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
                height: modelData.type === "h" ? 30 : 32

                // 分组标题：小灰字 + 上方留白（Omarchy 无分组，取其标题区的弱化语感）
                Text {
                  visible: modelData.type === "h"
                  text: modelData.text ?? ""
                  color: root.colors.on_surface_variant
                  opacity: 0.7
                  font.pixelSize: 11
                  font.weight: Font.Normal
                  font.family: "Noto Sans CJK SC"
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
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
                    color: root.colors.on_surface
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                    font.family: "monospace"
                  }

                  Text {
                    id: arrowText
                    anchors.left: parent.left
                    anchors.leftMargin: Math.round(parent.width * 0.46)
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.type === "b" ? "→" : ""
                    color: root.colors.primary
                    font.pixelSize: 15
                    font.family: "monospace"
                  }

                  Text {
                    anchors.left: arrowText.right
                    anchors.leftMargin: 10
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.type === "b" ? (modelData.title ?? "") : ""
                    color: root.colors.primary
                    font.pixelSize: 14
                    font.family: "Noto Sans CJK SC"
                    elide: Text.ElideRight
                  }
                }
              }
            }

            // 底部提示条：细分隔线 + 淡提示（Omarchy 底栏的弱化语感）
            Item {
              width: parent.width
              height: 36
              Rectangle {
                anchors.top: parent.top
                anchors.topMargin: 8
                width: parent.width
                height: 1
                color: root.withAlpha(root.colors.outline, 0.35)
              }
              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                text: "↑ ↓ 滚动 · ESC 关闭"
                color: root.colors.on_surface_variant
                opacity: 0.7
                font.pixelSize: 11
                font.family: "Noto Sans CJK SC"
              }
            }
          }
        }
      }
    }
  }
}
