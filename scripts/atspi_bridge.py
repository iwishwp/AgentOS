#!/usr/bin/env python3
"""AgentOS AT-SPI2 桥：以 JSON 输出无障碍树 / 执行动作 / 设置文本。

用法:
  atspi_bridge.py apps
  atspi_bridge.py tree <app名称> [最大深度|k=v ...]
      可选 k=v：depth=N（默认 16）、mode=interactive|full（默认 interactive：
      只输出可交互元素扁平清单）、roles=逗号分隔角色白名单（替代默认可交互
      判定）、compact=1（full 模式精简树：去 states/actions、叶子文本并入父节点）
  atspi_bridge.py clickseq <app名称> <按钮名1> <按钮名2> ...
      按序点击多个已知名称的按钮，单进程一次 DFS 建名→节点映射后逐个 doAction
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
MAX_CLICKSEQ = 32

# 按钮角色（GTK3 报 "push button"、GTK4 报 "button"，goose 实测回修，两者都收）
BUTTON_ROLES = ("button", "push button", "toggle button")

# interactive 模式默认判定的可交互角色（roles= 白名单可整体替换）
INTERACTIVE_ROLES = {
    *BUTTON_ROLES,
    "radio button",
    # 输入类
    "text", "entry", "edit bar", "spin button", "password text",
    # 链接与可点击容器类
    "link", "check box", "combo box", "menu item", "list item",
    "page tab", "tree item", "table cell", "slider", "menu", "list",
}

# 值非空文本角色：interactive 清单附带输出其内容（一跳同时看到显示屏/标签值）
TEXT_ROLES = {
    "text", "entry", "edit bar", "spin button", "password text",
    "label", "static", "heading", "paragraph",
}

# 已知 Web 运行时（懒建树需要等待构建完成）；GTK/Qt 无懒建树，触发即走
WEB_RUNTIME_HINTS = ("chromium", "chrome", "electron")


def looks_like_web_runtime(app_name):
    n = (app_name or "").lower()
    return any(h in n for h in WEB_RUNTIME_HINTS)


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


def role_of(acc):
    try:
        return acc.getRoleName()
    except Exception:
        return "?"


def name_of(acc):
    try:
        return acc.name
    except Exception:
        return None


def content_of(acc):
    """可见内容：Text 接口优先，失败回落 name（Qt label 不实现 Text 接口）。"""
    t = text_of(acc)
    if t and t.strip():
        return t
    n = name_of(acc)
    return n if n and n.strip() else None


def has_action(acc):
    try:
        return acc.queryAction().nActions > 0
    except Exception:
        return False


def cmd_tree_interactive(app, max_depth, roles_whitelist):
    """interactive 模式：DFS 扁平清单，只收可交互元素与值非空文本。
    定位：让调用方一跳拿到"可点清单"（名称+角色），替代"倒全树→LLM 找按钮名"——
    实测 gnome-calculator 全树 179KB，agent 消化该上下文单跳 10.9s。"""
    wanted = set(roles_whitelist) if roles_whitelist else INTERACTIVE_ROLES
    elements = []
    truncated = False
    for node in dfs(app, max_depth=max_depth):
        role = role_of(node)
        if roles_whitelist:
            if role not in wanted:
                continue
        elif role not in wanted:
            # 有动作接口（可点击）或值非空文本才收
            content = content_of(node) if role in TEXT_ROLES else None
            if not has_action(node) and content is None:
                continue
        entry = {"name": name_of(node), "role": role}
        content = content_of(node)
        if content is not None and content != entry["name"]:
            entry["text"] = content[:MAX_TEXT]
        v = value_of(node)
        if v is not None and str(v) != "":
            entry["value"] = str(v)
        elements.append(entry)
        if len(elements) >= MAX_NODES:
            truncated = True
            break
    out = {"app": name_of(app), "mode": "interactive", "count": len(elements),
           "elements": elements}
    if truncated:
        out["truncated"] = True
    return out


def serialize_compact(acc, depth, max_depth, counter):
    """full+compact 模式：每节点只留 name/role/text，叶子文本节点并入父节点
    （无子无动作的文本角色叶子，内容上提），去 states/actions——树体积约减一个量级。"""
    if counter[0] >= MAX_NODES:
        return {"truncated": True}
    counter[0] += 1
    node = {"name": name_of(acc), "role": role_of(acc)}
    own = content_of(acc)
    if own is not None:
        node["text"] = own[:MAX_TEXT]
    merged_texts = []
    children = []
    try:
        count = acc.childCount
    except Exception:
        count = 0
    if depth < max_depth and count > 0:
        for i in range(count):
            try:
                child = acc.getChildAtIndex(i)
            except Exception:
                continue
            if child is None:
                continue
            if is_pure_text_leaf(child):
                merged_texts.append((content_of(child) or "")[:MAX_TEXT])
                continue
            children.append(serialize_compact(child, depth + 1, max_depth, counter))
            if counter[0] >= MAX_NODES:
                break
    if "text" not in node and merged_texts:
        node["text"] = " | ".join(t for t in merged_texts if t)
    if children:
        node["children"] = children
    return node


def is_pure_text_leaf(acc):
    """叶子文本节点：文本角色、无子、无动作、有内容——compact 模式并入父节点。"""
    if role_of(acc) not in TEXT_ROLES:
        return False
    try:
        if acc.childCount > 0:
            return False
    except Exception:
        return False
    if has_action(acc):
        return False
    return content_of(acc) is not None


def parse_tree_opts(raw):
    """解析 tree 子命令的可选参数：位置 depth（兼容旧格式）+ k=v 键值。"""
    opts = {"depth": 16, "mode": "interactive", "compact": False, "roles": None}
    for tok in raw:
        if "=" not in tok:
            opts["depth"] = int(tok)
            continue
        key, val = tok.split("=", 1)
        if key == "depth":
            opts["depth"] = int(val)
        elif key == "mode":
            opts["mode"] = val
        elif key == "compact":
            opts["compact"] = val.lower() in ("1", "true", "yes")
        elif key == "roles":
            roles = [r.strip() for r in val.split(",") if r.strip()]
            opts["roles"] = roles or None
        else:
            raise SystemExit(f"未知 tree 参数 {tok!r}（可用 depth/mode/compact/roles）")
    if opts["mode"] not in ("interactive", "full"):
        raise SystemExit(f"未知 mode {opts['mode']!r}（interactive|full）")
    return opts


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


def click_node(node):
    """对节点执行第 0 号动作（默认点击）。"""
    act = node.queryAction()
    return bool(act.doAction(0))


def cmd_click(app, target):
    for node in dfs(app):
        try:
            # GTK3/GTK4 角色名不一致：GTK4 计算器上报 "button"（goose 实测发现并回修）
            if node.getRoleName() not in BUTTON_ROLES:
                continue
            if node.name == target:
                ok = click_node(node)
                return {"done": ok, "clicked": target}
        except Exception:
            continue
    raise RuntimeError(f"未找到名为 {target!r} 的按钮")


def scan_buttons(app):
    """单次 DFS 建 名称→按钮节点 映射（首个命中，与 cmd_click 语义一致）。
    clickseq 的批量点击共用这一张映射，N 连击从 N 次全树遍历变 1 次。"""
    mapping = {}
    for node in dfs(app):
        try:
            if node.getRoleName() not in BUTTON_ROLES:
                continue
            name = node.name
            if name and name not in mapping:
                mapping[name] = node
        except Exception:
            continue
    return mapping


def cmd_clickseq(app, names):
    """按序点击多个已知名称的按钮：一次进程调用完成整串，逐步返回结果数组。
    某步找不到名称时重扫一次树（UI 状态变化可能改名/重建），仍找不到则停在该步。"""
    buttons = scan_buttons(app)
    results = []
    failed = None
    for name in names:
        node = buttons.get(name)
        if node is None:
            buttons = scan_buttons(app)
            node = buttons.get(name)
        if node is None:
            failed = name
            results.append({"name": name, "ok": False, "error": "未找到该名称的按钮"})
            break
        try:
            ok = click_node(node)
            if ok:
                results.append({"name": name, "ok": True})
            else:
                failed = name
                results.append({"name": name, "ok": False, "error": "doAction 返回失败"})
                break
        except Exception as exc:  # 中途失效：树重建导致节点悬空
            failed = name
            results.append({"name": name, "ok": False, "error": str(exc)})
            break
    return {
        "done": failed is None,
        "clicked": sum(1 for r in results if r["ok"]),
        "failed": failed,
        "results": results,
    }


def cmd_texts(app):
    out = []
    for node in dfs(app):
        try:
            role = node.getRoleName()
            if role in ("text", "edit", "entry"):
                content = text_of(node)
                if content is not None and content.strip() != "":
                    out.append({"name": node.name, "text": content})
            elif role in ("label", "static", "heading", "paragraph"):
                # Qt 的 QLabel 不实现 AT-SPI Text 接口（queryText 抛异常），可见文本
                # 只在 accessible name 里（实测 PyQt5 2026-10-18：点击后 label 的
                # name 从"初始状态"变"你好，AgentOS"）；Chromium 的页面文本在
                # static/heading/paragraph（Text 接口可用）；GTK 的 label 走 Text
                # 接口。统一：Text 接口优先，失败回落 name，两者通吃
                content = text_of(node) or node.name
                if content and content.strip() != "":
                    out.append({"name": node.name, "text": content})
        except Exception:
            continue
    return {"texts": out}


def cmd_settext(app, match, new_text):
    for node in dfs(app):
        try:
            if node.getRoleName() not in ("text", "edit", "entry"):
                continue
            if match != "*" and match not in (node.name or ""):
                continue
            editable = node.queryEditableText()
            ok = editable.setTextContents(new_text)
            return {"done": bool(ok), "name": node.name}
        except Exception:
            continue
    raise RuntimeError(f"未找到可编辑文本节点（匹配 {match!r}）")


def prime_tree(app):
    """Chromium/Electron 懒建树触发：AT 对已注册对象调 GetAttributes/GetRelationSet
    后 Chromium 才开始构建页面内容树（Orca 走的同一条路）。
    树是异步构建的——对已知 Web 运行时触发后轮询等待；GTK/Qt 没有懒建树行为，
    只做一轮触发即返回（实测 2026-10-25：gnome-calculator 每次调用被 4×0.5s
    空轮询拖去 2.07s，a11y 调用本身 <0.3s——提速基准里这是最大单项浪费）。
    （实测 2026-10-18：触发前只有窗口装饰按钮，触发后 h1/button/input 全部出现。）"""
    def has_page_root():
        for node in dfs(app, max_depth=6):
            try:
                if node.getRoleName() == "document web":
                    return True
            except Exception:
                continue
        return False

    def touch():
        for node in dfs(app, max_depth=4):
            try:
                node.getAttributes()
                node.getRelationSet()
            except Exception:
                continue

    try:
        if app.childCount == 0:
            return
    except Exception:
        return
    if has_page_root():
        return
    touch()
    # 已知 Web 运行时才等树建完；其余（GTK/Qt/未知）触发即走——
    # 首次 dump 可能 partial 属正常，下一次就全（SKILL 已记）
    if has_page_root() or not looks_like_web_runtime(name_of(app)):
        return
    for _ in range(4):
        if has_page_root():
            return
        touch()
        time.sleep(0.5)


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

    if cmd not in ("tree", "action", "text", "click", "clickseq", "texts", "settext") or len(sys.argv) < 3:
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

    # Chromium/Electron 在这里触发懒建树（GTK/Qt 直接返回，最多 ~0.5s）
    prime_tree(app)

    # 名称寻址命令（推荐：跨进程稳定）
    if cmd == "click":
        if len(sys.argv) < 4:
            print("缺少按钮名", file=sys.stderr)
            return 2
        print(json.dumps(cmd_click(app, sys.argv[3]), ensure_ascii=False))
        return 0
    if cmd == "clickseq":
        if len(sys.argv) < 4:
            print("缺少按钮名列表", file=sys.stderr)
            return 2
        names = sys.argv[3:]
        if len(names) > MAX_CLICKSEQ:
            print(f"一次最多 {MAX_CLICKSEQ} 个按钮名", file=sys.stderr)
            return 2
        print(json.dumps(cmd_clickseq(app, names), ensure_ascii=False))
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
        try:
            opts = parse_tree_opts(sys.argv[3:])
        except (ValueError, SystemExit) as exc:
            print(f"tree 参数错误: {exc}", file=sys.stderr)
            return 2
        depth = max(1, min(opts["depth"], 16))
        if opts["mode"] == "interactive":
            # 默认：可交互元素扁平清单（一跳拿到可点清单，省 LLM 上下文）
            print(json.dumps(cmd_tree_interactive(app, depth, opts["roles"]),
                             ensure_ascii=False))
        elif opts["compact"]:
            print(json.dumps(serialize_compact(app, 0, depth, [0]), ensure_ascii=False))
        else:
            # 全树（兼容旧格式；结构分析用，token 量大）
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
