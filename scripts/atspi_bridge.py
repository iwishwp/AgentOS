#!/usr/bin/env python3
"""AgentOS AT-SPI2 桥：以 JSON 输出无障碍树 / 执行动作 / 设置文本。

用法:
  atspi_bridge.py apps
  atspi_bridge.py tree <app名称> <最大深度>
  atspi_bridge.py action <app名称> <逗号索引路径> <动作序号>
  atspi_bridge.py text   <app名称> <逗号索引路径> <新文本>

依赖: python3 + pyatspi（Fedora: at-spi2-core 自带总线；绑定随桌面组件提供）。
所有输出为单行 JSON；错误时退出码非 0、原因写 stderr。
"""
import json
import sys
import time

import pyatspi

MAX_NODES = 400
MAX_TEXT = 200


def find_app(name):
    desktop = pyatspi.Registry.getDesktop(0)
    for i in range(desktop.childCount):
        app = desktop.getChildAtIndex(i)
        if app and app.name == name:
            return app
        # 名称可能是 app_id（org.gnome.Calculator）或带 .desktop 后缀，做包含匹配
        if app and name in (app.name or ""):
            return app
    return None


def states_of(acc):
    try:
        raw = acc.getState().getStates()
        names = []
        for s in raw:
            try:
                names.append(pyatspi.stateTypeGetName(s))
            except Exception:
                names.append(str(s))
        return names
    except Exception:
        return []


def actions_of(acc):
    try:
        act = acc.queryAction()
        return [
            {"index": i, "name": act.getName(i), "description": act.getDescription(i)}
            for i in range(act.nActions)
        ]
    except Exception:
        return []


def text_of(acc):
    try:
        txt = acc.queryText()
        content = txt.getText(0, min(txt.characterCount, MAX_TEXT))
        return content
    except Exception:
        return None


def value_of(acc):
    try:
        val = acc.queryValue()
        return val.currentValue
    except Exception:
        return None


def serialize(acc, depth, max_depth, counter):
    if counter[0] >= MAX_NODES:
        return {"truncated": True}
    counter[0] += 1
    node = {}
    try:
        node["name"] = acc.name
    except Exception:
        node["name"] = None
    try:
        node["role"] = acc.getRoleName()
    except Exception:
        node["role"] = "?"
    node["states"] = states_of(acc)
    node["actions"] = actions_of(acc)
    t = text_of(acc)
    if t is not None:
        node["text"] = t
    v = value_of(acc)
    if v is not None:
        node["value"] = str(v)
    try:
        count = acc.childCount
    except Exception:
        count = 0
    if depth < max_depth and count > 0:
        children = []
        for i in range(count):
            try:
                child = acc.getChildAtIndex(i)
            except Exception:
                continue
            if child is None:
                continue
            children.append(serialize(child, depth + 1, max_depth, counter))
            if counter[0] >= MAX_NODES:
                break
        if children:
            node["children"] = children
    return node


def navigate(app, path_str):
    acc = app
    for part in path_str.split(","):
        idx = int(part)
        acc = acc.getChildAtIndex(idx)
        if acc is None:
            raise RuntimeError(f"路径 {path_str} 在索引 {idx} 处失效（应用结构可能已变化）")
    return acc


def dfs(acc, depth=0, max_depth=24):
    """深度优先产出节点。树结构跨 AT 连接可能重建，路径寻址不稳定——
    实际操作一律按 名称/角色 查找（click/texts/settext），路径仅用于单次 dump 内分析。"""
    yield acc
    if depth >= max_depth:
        return
    try:
        count = acc.childCount
    except Exception:
        return
    for i in range(count):
        try:
            child = acc.getChildAtIndex(i)
        except Exception:
            continue
        if child is not None:
            yield from dfs(child, depth + 1, max_depth)


def cmd_click(app, target):
    for node in dfs(app):
        try:
            # GTK3/GTK4 角色名不一致：GTK4 计算器上报 "button"（goose 实测发现并回修）
            if node.getRoleName() not in ("button", "push button", "toggle button"):
                continue
            if node.name == target:
                act = node.queryAction()
                ok = act.doAction(0)
                return {"done": bool(ok), "clicked": target}
        except Exception:
            continue
    raise RuntimeError(f"未找到名为 {target!r} 的按钮")


def cmd_texts(app):
    out = []
    for node in dfs(app):
        try:
            if node.getRoleName() in ("text", "edit"):
                content = text_of(node)
                if content is not None and content.strip() != "":
                    out.append({"name": node.name, "text": content})
        except Exception:
            continue
    return {"texts": out}


def cmd_settext(app, match, new_text):
    for node in dfs(app):
        try:
            if node.getRoleName() not in ("text", "edit"):
                continue
            if match != "*" and match not in (node.name or ""):
                continue
            editable = node.queryEditableText()
            ok = editable.setTextContents(new_text)
            return {"done": bool(ok), "name": node.name}
        except Exception:
            continue
    raise RuntimeError(f"未找到可编辑文本节点（匹配 {match!r}）")


def main():
    # 以 AT（辅助技术）身份向注册表登记：GTK4 等工具包收到 ATRegister 后才构建完整
    # 无障碍树，匿名一次性访问只能看到空骨架（实测 gnome-calculator 16→105 节点）
    pyatspi.Registry.registerEventListener(lambda *a, **k: None, "focus:")
    time.sleep(0.8)

    if len(sys.argv) < 2:
        print("用法: atspi_bridge.py apps|tree|action|text ...", file=sys.stderr)
        return 2
    cmd = sys.argv[1]

    if cmd == "apps":
        desktop = pyatspi.Registry.getDesktop(0)
        apps = []
        for i in range(desktop.childCount):
            app = desktop.getChildAtIndex(i)
            if app is None:
                continue
            try:
                apps.append({"name": app.name, "children": app.childCount})
            except Exception:
                pass
        print(json.dumps({"apps": apps}, ensure_ascii=False))
        return 0

    if cmd not in ("tree", "action", "text", "click", "texts", "settext") or len(sys.argv) < 3:
        print("参数不足", file=sys.stderr)
        return 2
    app = find_app(sys.argv[2])
    if app is None:
        names = []
        desktop = pyatspi.Registry.getDesktop(0)
        for i in range(desktop.childCount):
            a = desktop.getChildAtIndex(i)
            if a is not None:
                names.append(a.name)
        print(f"未找到应用 {sys.argv[2]}；当前注册: {names}", file=sys.stderr)
        return 1

    # 名称寻址命令（推荐：跨进程稳定）
    if cmd == "click":
        if len(sys.argv) < 4:
            print("缺少按钮名", file=sys.stderr)
            return 2
        print(json.dumps(cmd_click(app, sys.argv[3]), ensure_ascii=False))
        return 0
    if cmd == "texts":
        print(json.dumps(cmd_texts(app), ensure_ascii=False))
        return 0
    if cmd == "settext":
        if len(sys.argv) < 5:
            print("缺少参数", file=sys.stderr)
            return 2
        print(json.dumps(cmd_settext(app, sys.argv[3], sys.argv[4]), ensure_ascii=False))
        return 0

    # 路径寻址命令（仅当与 dump 在同一进程内使用才可靠，保留作调试）
    if len(sys.argv) < 4:
        print("参数不足", file=sys.stderr)
        return 2

    if cmd == "tree":
        depth = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        # libadwaita 嵌套很深，按钮常在 8 层以下（实测 gnome-calculator），上限放到 16
        depth = max(1, min(depth, 16))
        print(json.dumps(serialize(app, 0, depth, [0]), ensure_ascii=False))
        return 0

    acc = navigate(app, sys.argv[3])

    if cmd == "action":
        if len(sys.argv) < 5:
            print("缺少动作序号", file=sys.stderr)
            return 2
        act = acc.queryAction()
        ok = act.doAction(int(sys.argv[4]))
        print(json.dumps({"done": bool(ok), "name": acc.name}, ensure_ascii=False))
        return 0

    if cmd == "text":
        if len(sys.argv) < 5:
            print("缺少新文本", file=sys.stderr)
            return 2
        editable = acc.queryEditableText()
        ok = editable.setTextContents(sys.argv[4])
        print(json.dumps({"done": bool(ok), "name": acc.name}, ensure_ascii=False))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
