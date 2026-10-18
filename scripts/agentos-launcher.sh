#!/usr/bin/env bash
# AgentOS 启动器统一入口（niri Super+D / Super+Space 绑定这里）
# 首选状态栏同款（Noctalia 启动面板，经 quickshell IPC）；状态栏不在时回退 fuzzel。
# 换状态栏只需让新 shell 提供 quickshell IPC target "launcher"，或改本脚本一处——
# 键位与用户习惯不受影响（解耦层，2026-10-18 用户提出的设计约束）。
set -euo pipefail
if qs -c noctalia ipc call launcher toggle >/dev/null 2>&1; then
  exit 0
fi
exec fuzzel
