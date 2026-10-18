# ADR-0002：设置编排——TS 守护进程（长期方向 Rust 全量切换）

日期：2026-10-18 · 状态：已采纳（v1 落地）

## 背景

缝合桌面期的主题联动是钩子链：Noctalia 三钩子 → theme-apply-all.sh → 五个 shell 桥
（内嵌 python heredoc，色板读取逻辑重复四份）。只在钩子触发时收敛、无状态、无 API、
每桥一个 python 进程；用户长期方向是全项目 Rust。

## 决策

新建 `packages/settings-daemon`（TypeScript 常驻进程）收编编排：watcher（colors.json
覆写=事件源）+ 单一状态快照（真相仍来自 noctalia 现有文件，不另立）+ 五桥共享 palette
模块 + D-Bus `org.agentos.Settings` + unix socket 降级 + CLI `agentos-settings`。
Noctalia 三个钩子清空（enabled 保留），职责移交 watcher。旧脚本保留为遗留兼容。

## 为什么 TS（而不是直接 Rust）

1. 复用现有 monorepo 语言栈与基建（@agentos/proc 的 Runner/FakeRunner 测试基建、
   vitest、tsc 工作流），一轮落地；dbus-next 纯 JS 无原生依赖。
2. 行为先钉死、语言后迁移：五桥逻辑与旧 shell 桥做了**字节级对拍**测试，
   环保护/状态映射也有单测——将来换语言时这些测试就是行为规格。
3. 全项目 Rust 化时本包是第一批迁移对象（zbus + notify），接口
   （D-Bus 名/路径/成员、socket 协议、state 文件格式）保持不变即可无感切换。

## 后果

- 主题联动从"钩子触发时收敛"变为"事件驱动常驻收敛"，可 `status` 可编程控制。
- 新增常驻进程一个（内存占用小，node 单进程）；systemd `Restart=on-failure` 兜底。
- 色板读取四份重复消除；旧链脚本降级为兼容入口。
