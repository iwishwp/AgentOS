#!/usr/bin/env python3
"""org.agentos.Confirm1 —— AgentOS 用户级确认服务（权限模型 v1 的 T1 通道）。

接口（docs/permissions.md §4.1，另加一个便捷方法 Wait）：
  Request(s agent, s tool, s summary_redacted, s tier) → (u req_id)
  Respond(u req_id, s choice)          # 编程应答（测试/无障碍驱动/其它客户端）
  Wait(u req_id, i timeout_ms) → (s choice, s by, u elapsed_ms)   # 阻塞到出结果
  信号 Confirmed(u req_id, s choice, s by)

choice ∈ {allow_once, allow_session, deny_once, always_deny}
（allow_session 的记忆表与 always_deny 的 policy.yaml 写回在【调用方】@agentos/policy
 的 ConfirmClient 里——服务本身无状态，重启不丢语义）。

通知载体（Fedora mako 1.11 实测：不渲染动作按钮，见 CHOICE_BANNERS 处注释）：
每个选择各发一条带默认动作的横幅，点击哪条即哪个选择，自上而下读作
允许/会话允许/拒绝/永不。30 秒无应答 = deny_once（超时后主动 CloseNotification）。
服务不可运行时的安全语义由调用方兜底：确认通道不存在 ⇒ 拒绝执行。
"""
import sys
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

BUS_NAME = "org.agentos.Confirm1"
OBJ_PATH = "/org/agentos/confirm"
NOTIFY_NAME = "org.freedesktop.Notifications"
NOTIFY_PATH = "/org/freedesktop/Notifications"
TIMEOUT_MS = 30_000
CHOICES = ("allow_once", "allow_session", "deny_once", "always_deny")

NODE_XML = """
<node>
  <interface name="org.agentos.Confirm1">
    <method name="Request">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="tool"/>
      <arg type="s" direction="in" name="summary"/>
      <arg type="s" direction="in" name="tier"/>
      <arg type="u" direction="out" name="req_id"/>
    </method>
    <method name="Respond">
      <arg type="u" direction="in" name="req_id"/>
      <arg type="s" direction="in" name="choice"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="Wait">
      <arg type="u" direction="in" name="req_id"/>
      <arg type="i" direction="in" name="timeout_ms"/>
      <arg type="s" direction="out" name="choice"/>
      <arg type="s" direction="out" name="by"/>
      <arg type="u" direction="out" name="elapsed_ms"/>
    </method>
    <signal name="Confirmed">
      <arg type="u" name="req_id"/>
      <arg type="s" name="choice"/>
      <arg type="s" name="by"/>
    </signal>
  </interface>
</node>
"""

# 等价载体：mako 不渲染动作按钮（actions=0|1 只控制"整条通知的默认动作"，
# Fedora mako 1.11 实测如此，见 permissions.md §4.1 载体备注），故每个选择
# 各发一条带默认动作的通知——点击哪条就是哪个选择。发送顺序倒排，
# mako 新通知在上，最终自上而下读作 允许/会话允许/拒绝/永不。
CHOICE_BANNERS = [
    ("deny_once", "🚫 永不允许", "写入 policy.yaml，同类请求不再询问"),
    ("allow_session", "🔁 本次会话允许", "本次登录会话内同类请求不再询问"),
    ("deny_once", "⛔ 拒绝", "本次不执行"),
    ("allow_once", "✅ 允许", "仅本次执行"),
]


class Request:
    __slots__ = ("id", "agent", "tool", "started", "choices", "timer_id", "result")

    def __init__(self, rid, agent, tool):
        self.id = rid
        self.agent = agent
        self.tool = tool
        self.started = time.monotonic()
        self.choices = {}  # notif_id -> choice（点击哪条通知=哪个选择）
        self.timer_id = 0
        self.result = None  # (choice, by) 首次 resolve 定终身


class ConfirmService:
    def __init__(self):
        self.bus = None
        self.notify = None
        self.node = Gio.DBusNodeInfo.new_for_xml(NODE_XML)
        self.iface = self.node.interfaces[0]
        self.requests = {}  # req_id -> Request
        self.next_id = 1

    # ---------- D-Bus 服务 ----------
    def bus_acquired(self, bus, name):
        self.bus = bus
        bus.register_object(OBJ_PATH, self.iface, self.handle_call, None, None)
        self.notify = Gio.DBusProxy.new_sync(
            bus,
            Gio.DBusProxyFlags.NONE,
            None,
            NOTIFY_NAME,
            NOTIFY_PATH,
            NOTIFY_NAME,
            None,
        )
        if self.notify is None or self.notify.get_name_owner() is None:
            print(f"WARN: 未发现通知守护进程（{NOTIFY_NAME}）——确认通知将无法显示", file=sys.stderr)
        self.notify.connect("g-signal", self.on_notify_signal)
        print(f"agentos-confirm: 就绪（{name} {OBJ_PATH}）", file=sys.stderr)

    def name_lost(self, bus, name):
        print(f"agentos-confirm: 总线名 {name} 已被占用（服务已在跑？）", file=sys.stderr)
        raise SystemExit(1)

    def handle_call(self, conn, sender, path, iface, method, params, invocation):
        try:
            if method == "Request":
                agent, tool, summary, tier = params.unpack()
                rid = self.do_request(sender, agent, tool, summary, tier)
                invocation.return_value(GLib.Variant("(u)", (rid,)))
            elif method == "Respond":
                req_id, choice = params.unpack()
                ok = self.do_respond(req_id, choice)
                invocation.return_value(GLib.Variant("(b)", (ok,)))
            elif method == "Wait":
                req_id, timeout_ms = params.unpack()
                out = self.do_wait(req_id, timeout_ms)
                invocation.return_value(GLib.Variant("(ssu)", out))
            else:
                invocation.return_dbus_error(
                    f"{BUS_NAME}.UnknownMethod", f"未知方法 {method}"
                )
        except Exception as e:  # noqa: BLE001 —— 任何异常都转成 D-Bus 错误回给调用方
            invocation.return_dbus_error(f"{BUS_NAME}.Internal", f"{type(e).__name__}: {e}")

    # ---------- 核心流程 ----------
    def do_request(self, sender, agent, tool, summary, tier):
        req = Request(self.next_id, agent or "agent", tool or "tool")
        self.next_id += 1
        self.requests[req.id] = req
        tier_label = {"t1": "T1 确认", "t2": "T2 强确认"}.get(tier, tier)
        for choice, title, note in CHOICE_BANNERS:
            body = f"{agent}.{tool}"
            if summary and summary != "(参数摘要不可用)":
                body += f"\n{summary}"
            if choice == "allow_once":
                body += f"\n（{tier_label} · 30 秒无响应视为拒绝）"
            try:
                notif_id = self.notify.Notify(
                    "(susssasa{sv}i)",
                    "AgentOS",            # app_name
                    0,                    # replaces_id
                    "dialog-information", # icon
                    title,
                    body,
                    ["default", title],   # 默认动作：点这条通知 = 这个选择
                    # critical：mako 对 critical 不自动过期，超时后由我们统一收走
                    {"urgency": GLib.Variant("y", 2)},
                    TIMEOUT_MS,
                )
                req.choices[notif_id] = choice
            except Exception as e:  # noqa: BLE001 —— 通知系统缺失时记录，仍走超时拒绝路径
                print(f"WARN: Notify 失败: {e}", file=sys.stderr)
        req.timer_id = GLib.timeout_add(TIMEOUT_MS + 500, self.on_timeout, req)
        print(f"agentos-confirm: Request #{req.id} {agent}.{tool} tier={tier}", file=sys.stderr)
        return req.id

    def on_notify_signal(self, proxy, sender, signal, params):
        if not self.requests:
            return
        args = params.unpack()
        if signal == "ActionInvoked":
            notif_id, _action = args
            for req in self.requests.values():
                if notif_id in req.choices:
                    # 点了哪条通知 = 哪个选择（mako 左键触发默认动作）
                    self.resolve(req, req.choices[notif_id], "notify-action")
                    return
        # NotificationClosed 不作为决定：横幅的收起/超时由 30s 计时器统一裁决，
        # 只有明确点选（ActionInvoked）或编程应答（Respond）才算用户决定。

    def on_timeout(self, req):
        req.timer_id = 0
        if req.result is None:
            self.close_notification(req)
            self.resolve(req, "deny_once", "timeout")
        return False  # 单次

    def do_respond(self, req_id, choice):
        req = self.requests.get(req_id)
        if req is None:
            return False
        if choice not in CHOICES:
            return False
        self.close_notification(req)
        self.resolve(req, choice, "respond")
        return True

    def resolve(self, req, choice, by):
        if req.result is not None:
            return  # 已决，弃后续（先到的为准）
        req.result = (choice, by)
        elapsed_ms = int((time.monotonic() - req.started) * 1000)
        if req.timer_id:
            GLib.source_remove(req.timer_id)
            req.timer_id = 0
        self.close_notification(req)
        try:
            self.bus.emit_signal(
                None,
                OBJ_PATH,
                BUS_NAME,
                "Confirmed",
                GLib.Variant("(uss)", (req.id, choice, by)),
            )
        except Exception as e:  # noqa: BLE001
            print(f"WARN: Confirmed 信号发送失败: {e}", file=sys.stderr)
        # 结果保留 5 分钟供 Wait 补查，之后清理
        GLib.timeout_add(300_000, self.requests.pop, req.id, None)

    def close_notification(self, req):
        for notif_id in list(req.choices):
            try:
                self.notify.CloseNotification("(u)", notif_id)
            except Exception:  # noqa: BLE001 —— 通知可能已不在
                pass
        req.choices.clear()

    def do_wait(self, req_id, timeout_ms):
        """阻塞直到 req_id 有结果或超时。等待期间继续迭代主循环（不阻塞其他调用）。"""
        deadline = time.monotonic() + max(0, timeout_ms) / 1000.0
        ctx = GLib.MainContext.default()
        while True:
            req = self.requests.get(req_id)
            result = req.result if req is not None else ("deny_once", "gone")
            if result is not None:
                elapsed = int((time.monotonic() - req.started) * 1000) if req else 0
                return (result[0], result[1], elapsed)
            if time.monotonic() >= deadline:
                return ("", "", 0)
            ctx.iteration(False)  # 非阻塞推进主循环（处理其他方法调用/信号）
            time.sleep(0.05)

    def run(self):
        Gio.bus_own_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            self.bus_acquired,
            lambda *a: None,
            self.name_lost,
        )
        GLib.MainLoop().run()


if __name__ == "__main__":
    ConfirmService().run()
