// AgentOS 键位速查浮层（qs -c agentos-hotkeys）
//
// Omarchy/niri 原生心智：按 Super+K 居中弹出一块浮层，一行一条键位；
// 本实现是 layer-shell 覆盖层（不是应用窗口）：全屏透明层 + 居中面板，
// 点任意处或按 Esc 关闭（进程即退，无常驻）。
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

        // 压暗背景（overlay 质感；点按即关）
        Rectangle { anchors.fill: parent; color: "#000000"; opacity: 0.35 }
        MouseArea { anchors.fill: parent; onClicked: Qt.quit() }

        // ---- 居中面板（Omarchy/niri 心智：一行一条，超高滚动） ----
        Rectangle {
          id: panel
          // 尺寸绑 screen（创建瞬间 contentItem 可能未定型，绑 parent.width 会得负值）
          readonly property real panelWidth: Math.min(640, (win.screen?.width ?? 1280) - 80)
          readonly property real maxH: (win.screen?.height ?? 800) - 100
          readonly property real contentH: Math.min(view.contentHeight + 56, maxH)

          width: panelWidth
          height: contentH
          anchors.centerIn: parent
          radius: 16
          color: root.colors.surface_container
          border.width: 1
          border.color: root.colors.outline_variant

          // 面板本体拦截点按（点内容不穿透关闭，避免误触；点面板外关闭）
          MouseArea { anchors.fill: parent; onClicked: {} }

          Column {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Text {
              text: "键位速查"
              color: root.colors.on_surface_variant
              font.pixelSize: 13
              font.bold: true
              anchors.horizontalCenter: parent.horizontalCenter
              bottomPadding: 2
            }

            ListView {
              id: view
              width: parent.width
              height: parent.height - 30
              clip: true
              interactive: true
              spacing: 2

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
                height: modelData.type === "h" ? 30 : 26

                Text {
                  visible: modelData.type === "h"
                  text: modelData.text ?? ""
                  color: root.colors.on_surface_variant
                  font.pixelSize: 12
                  font.bold: true
                  topPadding: 8
                }

                Row {
                  visible: modelData.type === "b"
                  height: 26
                  spacing: 10

                  Rectangle {
                    width: keyLabel.implicitWidth + 16
                    height: 22
                    radius: 6
                    anchors.verticalCenter: parent.verticalCenter
                    color: root.colors.surface_container_highest
                    border.width: 1
                    border.color: root.colors.outline

                    Text {
                      id: keyLabel
                      anchors.centerIn: parent
                      text: modelData.keys ?? ""
                      color: root.colors.primary
                      font.pixelSize: 12
                      font.family: "monospace"
                    }
                  }

                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.title ?? ""
                    color: root.colors.on_surface
                    font.pixelSize: 13
                    elide: Text.ElideRight
                    width: panel.width - keyLabel.implicitWidth - 80
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
