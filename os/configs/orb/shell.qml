// AgentOS goose 悬浮球（qs -c agentos-orb）
//
// 桌面右缘垂直居中的 48px 小球，goose 工作进展的唯一驻留载体（不占任务栏、
// 不抢键盘焦点）。三个状态：
//   idle      低饱和小圆点静置球心
//   working   最近审计行仍在静默阈值内 → 呼吸动画，hover/标签显示正在用的工具
//   attention Confirm1 有未决请求 → primary 描边加粗 + 轻微弹跳 + 常显"N 项待确认"
//
// 数据源（v1 就两个，见 docs/orb.md）：
//   1. 审计流 ~/.local/state/agentos/audit.jsonl（tail -n 20 -F 逐行跟随，
//      无 FileView watchChanges 的"文件尚未创建收不到事件"问题）
//   2. Confirm1.ListPending()（os/dbus/agentos-confirm.py 的只读方法，2s 轮询）
//
// 配色零副本：读 ~/.config/noctalia/colors.json，缺省退化为内置莫兰迪同值色板
//（与 agentos-hotkeys 同款）。用户配置 ~/.config/agentos/orb.json：
//   { enabled, quiet_after_secs, edge_gap_px }
//
// 毛玻璃：quickshell 0.3.2 客户端侧 BackgroundEffect.blurRegion（ext-background-
// effect-v1，niri 26.04 支持；Noctalia Dock/Bar 同款机制），只模糊球与面板本体。
//
// 调试：AGENTOS_ORB_DUMP=1 时打一行状态到 stderr（不弹窗继续常驻）。

import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Wayland._BackgroundEffect
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

  function withAlpha(hex, a) {
    const h = String(hex).replace("#", "");
    return Qt.rgba(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255, a);
  }

  // ---- 用户配置（orb.json，全部可缺省） ----
  readonly property var defaults: ({ "enabled": true, "quiet_after_secs": 30, "edge_gap_px": 12 })
  property var cfg: defaults
  readonly property bool enabled: cfg.enabled !== false
  readonly property int quietMs: (cfg.quiet_after_secs ?? 30) * 1000
  readonly property int edgeGap: cfg.edge_gap_px ?? 12

  // ---- 审计流状态（tail 进程逐行喂进来） ----
  property var activities: []        // 最近 5 条 {ts, extension, tool, decision}
  property real lastAuditMs: 0       // 最近一条审计行的时间戳（epoch ms）
  property string currentTool: ""
  property string currentExt: ""

  // ---- Confirm1 未决请求（2s 轮询） ----
  property var pending: []           // [{id, agent, tool, summary, tier}]

  // ---- 状态机：attention > working > idle；working 由 1s 定时器重评 ----
  property bool workingNow: false
  readonly property string state: pending.length > 0 ? "attention" : (workingNow ? "working" : "idle")

  property bool panelOpen: false

  function pushActivity(entry) {
    const arr = root.activities.slice();
    arr.push(entry);
    root.activities = arr.slice(-5);
    const ms = Date.parse(entry.ts ?? "");
    if (!isNaN(ms)) root.lastAuditMs = ms;
    if (entry.tool) { root.currentTool = entry.tool; root.currentExt = entry.extension ?? ""; }
  }

  // gdbus call 输出形如：[(uint32 5, 'goose', 'shell', '删除 Downloads 目录', 't1')]
  function parsePending(raw) {
    const out = [];
    const re = /\(uint32 (\d+), '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      out.push({ id: m[1], agent: m[2], tool: m[3], summary: m[4], tier: m[5] });
    }
    return out;
  }

  Component.onCompleted: {
    try { root.colors = Object.assign({}, root.fallbackColors, JSON.parse(colView.text())); }
    catch (e) { console.warn("[orb] colors.json 不可用，用兜底色板: " + e); }
    try {
      const c = JSON.parse(cfgView.text());
      root.cfg = Object.assign({}, root.defaults, typeof c === "object" && c ? c : {});
    } catch (e) { console.warn("[orb] orb.json 不可用，用默认配置: " + e); }
    console.warn("[orb] 就绪 enabled=" + enabled + " quiet=" + (quietMs / 1000) + "s gap=" + edgeGap + "px");
    if (Quickshell.env("AGENTOS_ORB_DUMP")) console.warn("[orb] dump 模式");
  }

  FileView {
    id: colView
    blockLoading: true
    watchChanges: false
    path: Quickshell.env("AGENTOS_COLORS_JSON") || (Quickshell.env("HOME") + "/.config/noctalia/colors.json")
  }

  FileView {
    id: cfgView
    blockLoading: true
    watchChanges: false
    path: Quickshell.env("AGENTOS_ORB_JSON") || (Quickshell.env("HOME") + "/.config/agentos/orb.json")
  }

  // ---- 数据源 1：审计流跟随（tail -F 等文件出现；-n 20 只回放尾部，全量文件不重放） ----
  Process {
    id: auditTail
    running: root.enabled
    command: ["tail", "-n", "20", "-F",
      Quickshell.env("AGENTOS_AUDIT_PATH") || (Quickshell.env("HOME") + "/.local/state/agentos/audit.jsonl")]
    stdout: SplitParser {
      splitMarker: "\n"
      onRead: data => {
        const line = String(data).trim();
        if (!line) return;
        try { root.pushActivity(JSON.parse(line)); }
        catch (e) { /* 半截行/非 JSON：tail -F 轮转期偶尔出现，忽略 */ }
      }
    }
  }

  // ---- 数据源 2：Confirm1.ListPending 轮询 ----
  Process {
    id: confirmPoll
    command: ["gdbus", "call", "--session",
      "--dest", "org.agentos.Confirm1",
      "--object-path", "/org/agentos/confirm",
      "--method", "org.agentos.Confirm1.ListPending"]
    stdout: StdioCollector {
      onStreamFinished: { root.pending = root.parsePending(text); }
    }
  }

  Timer {
    interval: 2000
    running: root.enabled
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      // Process 无自动重启：先停再起复用同一实例
      confirmPoll.running = false;
      confirmPoll.running = true;
    }
  }

  // ---- working 重评（静默超阈值即回 idle） ----
  Timer {
    interval: 1000
    running: root.enabled
    repeat: true
    onTriggered: {
      root.workingNow = root.lastAuditMs > 0 && (Date.now() - root.lastAuditMs) < root.quietMs;
      if (Quickshell.env("AGENTOS_ORB_DUMP"))
        console.warn("[orb] state=" + root.state + " pending=" + root.pending.length + " last=" + Math.round((Date.now() - root.lastAuditMs) / 1000) + "s");
    }
  }

  // ---- 打开 /replay /artifacts（chromium 应用窗口，flags 对齐 desktop-mcp 实测结论） ----
  function openAppPage(path) {
    Quickshell.execDetached(["chromium-browser", "--app=http://127.0.0.1:7788" + path, "--password-store=basic"]);
  }

  Variants {
    model: Quickshell.screens

    // ==================== 球窗口（右缘垂直居中） ====================
    delegate: PanelWindow {
      id: orbWin

      required property ShellScreen modelData
      screen: modelData
      visible: root.enabled

      // 窗口 = 球 + 左侧标签区；球永远在窗口右端 → 窗口右缘即球右缘
      implicitWidth: 264
      implicitHeight: 64
      anchors { top: true; right: true }
      margins {
        top: Math.round(((screen?.height ?? 800) - implicitHeight) / 2)
        right: root.edgeGap
      }
      color: "transparent"

      WlrLayershell.namespace: "agentos-orb-" + (modelData?.name || "unknown")
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      WlrLayershell.exclusionMode: ExclusionMode.Ignore

      // 毛玻璃只作用于球本体（客户端请求 blur region，niri 26.04 消费）
      BackgroundEffect.blurRegion: Region { item: ball }

      // ---- 球（48px 圆，窗口右端垂直居中） ----
      Rectangle {
        id: ball
        width: 48; height: 48
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        radius: 24
        color: root.withAlpha(root.colors.surface_container, root.state === "attention" ? 0.92 : 0.72)
        border.width: root.state === "attention" ? 3 : 1
        border.color: root.state === "attention"
          ? root.colors.primary
          : root.withAlpha(root.colors.outline_variant, 0.6)

        // attention 弹跳：scale 1 ↔ 1.07 循环（transformOrigin 默认 Center）
        SequentialAnimation {
          running: root.state === "attention"
          loops: Animation.Infinite
          NumberAnimation { target: ball; property: "scale"; to: 1.07; duration: 240; easing.type: Easing.OutQuad }
          NumberAnimation { target: ball; property: "scale"; to: 1.0; duration: 240; easing.type: Easing.InQuad }
          PauseAnimation { duration: 420 }
        }

        // 球心状态圆点：idle=小而灰；working=primary 色呼吸
        Rectangle {
          id: coreDot
          width: root.state === "idle" ? 8 : 13; height: width
          anchors.centerIn: parent
          radius: width / 2
          color: root.state === "idle"
            ? root.withAlpha(root.colors.on_surface_variant, 0.75)
            : root.colors.primary

          SequentialAnimation {
            running: root.state === "working"
            loops: Animation.Infinite
            NumberAnimation { target: coreDot; property: "opacity"; to: 0.35; duration: 900; easing.type: Easing.InOutSine }
            NumberAnimation { target: coreDot; property: "opacity"; to: 1.0; duration: 900; easing.type: Easing.InOutSine }
          }
        }

        MouseArea {
          id: ballHover
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.panelOpen = !root.panelOpen
        }
      }

      // ---- 球左侧标签：attention 常显待确认数；working hover 显示当前工具 ----
      Rectangle {
        id: orbLabel
        width: labelRow.implicitWidth + 20
        height: 30
        anchors.right: ball.left
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        radius: 8
        color: root.withAlpha(root.colors.surface_container, 0.9)
        border.width: 1
        border.color: root.state === "attention" ? root.colors.primary : root.withAlpha(root.colors.outline_variant, 0.5)
        visible: root.state === "attention" || (root.state === "working" && ballHover.containsMouse)

        Row {
          id: labelRow
          anchors.centerIn: parent
          spacing: 6

          Rectangle {
            width: 7; height: 7; radius: 4
            anchors.verticalCenter: parent.verticalCenter
            visible: root.state === "attention"
            color: root.colors.primary
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: root.state === "attention"
              ? (root.pending.length > 1 ? root.pending.length + " 项待确认" : "待确认")
              : (root.currentExt ? root.currentExt + "." + root.currentTool : "working")
            color: root.state === "attention" ? root.colors.primary : root.colors.on_surface
            font.pixelSize: 13
            font.family: "monospace"
          }
        }
      }

      // 透明区域不吃鼠标：没有 MouseArea 即穿透（仅球与标签可交互）
    }

    // ==================== 展开面板（点击球弹出，点面板外收起） ====================
    // 注意：Variants 的 delegate 只允许一个直接子对象，面板放第二个 Variants
  }

  Variants {
    model: Quickshell.screens

    delegate: PanelWindow {
      id: panelWin

      required property ShellScreen modelData
      screen: modelData
      visible: root.enabled && root.panelOpen

      implicitWidth: 424
      implicitHeight: Math.min(620, (screen?.height ?? 800) - 24)
      anchors { top: true; right: true }
      margins {
        top: Math.max(12, Math.round(((screen?.height ?? 800) - implicitHeight) / 2 - 140))
        right: root.edgeGap
      }
      color: "transparent"

      WlrLayershell.namespace: "agentos-orb-panel-" + (modelData?.name || "unknown")
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      WlrLayershell.exclusionMode: ExclusionMode.Ignore

      BackgroundEffect.blurRegion: Region { item: panelBody }

      // 点面板外（本窗口的透明边缘）收起
      MouseArea { anchors.fill: parent; onClicked: root.panelOpen = false }

      Rectangle {
        id: panelBody
        width: 400
        height: parent.height
        anchors.right: parent.right
        radius: 14
        color: root.withAlpha(root.colors.surface_container, 0.88)
        border.width: 1
        border.color: root.state === "attention"
          ? root.colors.primary
          : root.withAlpha(root.colors.outline_variant, 0.5)

        MouseArea { anchors.fill: parent; onClicked: {} } // 点面板本体不收起

        Column {
          id: panelCol
          anchors.fill: parent
          anchors.margins: 18
          spacing: 14

          // ---- 状态头 ----
          Row {
            id: statusRow
            spacing: 10
            width: panelCol.width

            Rectangle {
              id: statusDot
              width: 12; height: 12; radius: 6
              anchors.verticalCenter: parent.verticalCenter
              color: root.state === "idle"
                ? root.withAlpha(root.colors.on_surface_variant, 0.75)
                : root.colors.primary
              SequentialAnimation {
                running: root.state === "working"
                loops: Animation.Infinite
                NumberAnimation { target: statusDot; property: "opacity"; to: 0.35; duration: 900 }
                NumberAnimation { target: statusDot; property: "opacity"; to: 1.0; duration: 900 }
              }
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.state === "attention" ? "需要你确认"
                    : root.state === "working" ? "goose 干活中：" + (root.currentExt ? root.currentExt + "." + root.currentTool : "…")
                    : "goose 待命"
              color: root.state === "attention" ? root.colors.primary : root.colors.on_surface
              font.pixelSize: 15
              font.family: "monospace"
              elide: Text.ElideRight
              width: statusRow.width - 22
            }
          }

          // ---- 待确认块（有未决请求时常驻置顶） ----
          Rectangle {
            visible: root.pending.length > 0
            width: panelCol.width
            height: pendingCol.implicitHeight + 24
            radius: 10
            color: root.withAlpha(root.colors.surface_container_highest, 0.7)
            border.width: 2
            border.color: root.colors.primary

            Column {
              id: pendingCol
              anchors.fill: parent
              anchors.margins: 12
              spacing: 8

              Text {
                text: root.pending.length > 1 ? root.pending.length + " 项等待你的选择" : "1 项等待你的选择"
                color: root.colors.primary
                font.pixelSize: 14
                font.family: "monospace"
              }

              Repeater {
                model: root.pending
                Text {
                  required property var modelData
                  width: pendingCol.width
                  text: "· " + modelData.agent + "." + modelData.tool
                    + (modelData.tier ? "（" + modelData.tier.toUpperCase() + "）" : "")
                    + (modelData.summary ? "\n  " + modelData.summary : "")
                  color: root.colors.on_surface_variant
                  font.pixelSize: 12
                  font.family: "monospace"
                  wrapMode: Text.WrapAnywhere
                }
              }

              Text {
                text: "点桌面右侧横幅选择（超时视为拒绝）"
                color: root.colors.on_surface_variant
                opacity: 0.8
                font.pixelSize: 11
                font.family: "monospace"
              }
            }
          }

          // ---- 最近活动 ----
          Text {
            text: "最近活动"
            color: root.colors.on_surface_variant
            opacity: 0.7
            font.pixelSize: 11
            font.family: "monospace"
          }

          Column {
            id: activityCol
            width: panelCol.width
            spacing: 8

            Repeater {
              model: root.activities.slice().reverse() // 最新在上
              Item {
                id: actRow
                required property var modelData
                width: activityCol.width
                height: 18

                Text {
                  id: actTime
                  anchors.left: actRow.left
                  anchors.verticalCenter: actRow.verticalCenter
                  text: Qt.formatDateTime(new Date(actRow.modelData.ts ?? 0), "HH:mm:ss")
                  color: root.colors.on_surface_variant
                  opacity: 0.75
                  font.pixelSize: 12
                  font.family: "monospace"
                }

                Text {
                  id: actTool
                  anchors.left: actTime.right
                  anchors.leftMargin: 8
                  anchors.verticalCenter: actRow.verticalCenter
                  text: actRow.modelData.extension + "." + actRow.modelData.tool
                  color: root.colors.on_surface
                  font.pixelSize: 12
                  font.family: "monospace"
                  width: actRow.width - actTime.width - 60
                  elide: Text.ElideRight
                }

                Text {
                  anchors.right: actRow.right
                  anchors.verticalCenter: actRow.verticalCenter
                  text: actRow.modelData.decision === "allow" ? "✓" : (actRow.modelData.decision === "deny" ? "✗" : "?")
                  color: actRow.modelData.decision === "allow"
                    ? root.withAlpha(root.colors.on_surface_variant, 0.8)
                    : root.colors.primary
                  font.pixelSize: 12
                  font.family: "monospace"
                }
              }
            }

            Text {
              visible: root.activities.length === 0
              text: "（暂无审计记录）"
              color: root.colors.on_surface_variant
              opacity: 0.6
              font.pixelSize: 12
              font.family: "monospace"
            }
          }

          // ---- 快捷入口 ----
          Row {
            width: panelCol.width
            spacing: 10

            Rectangle {
              width: (parent.width - 10) / 2; height: 38
              radius: 8
              color: root.withAlpha(root.colors.surface_container_highest, 0.85)
              border.width: 1
              border.color: root.withAlpha(root.colors.outline_variant, 0.5)

              Text {
                anchors.centerIn: parent
                text: "会话回放 /replay"
                color: root.colors.on_surface
                font.pixelSize: 13
                font.family: "monospace"
              }
              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: { root.openAppPage("/replay"); }
              }
            }

            Rectangle {
              width: (parent.width - 10) / 2; height: 38
              radius: 8
              color: root.withAlpha(root.colors.surface_container_highest, 0.85)
              border.width: 1
              border.color: root.withAlpha(root.colors.outline_variant, 0.5)

              Text {
                anchors.centerIn: parent
                text: "产物索引 /artifacts"
                color: root.colors.on_surface
                font.pixelSize: 13
                font.family: "monospace"
              }
              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: { root.openAppPage("/artifacts"); }
              }
            }
          }
        }
      }
    }
  }
}
