#!/usr/bin/env python3
"""uinput 虚拟数字化仪（tablet/pen 协议）——绝对坐标指针注入。

背景（前人结论，M2/M4 采信，别重走）：
  - ydotool mousemove -a 受 libinput 指针加速度拖累，绝对定位漂移；
  - 自建 uinput pointer 协议（ABS 轴）与单点触摸屏协议，niri/smithay 均不消费。

本工具走第三条路：**tablet/pen 协议**。数字化仪是原生绝对坐标设备，libinput 对
tablet 的支持完整（无加速度语义），合成器把 pen 位置映射为光标移动、笔尖触底
（BTN_TOUCH）映射为按下——与 wacom 数位板同一代码路径。

用法（需要 /dev/uinput 写权限，默认 root:600——mouse-click.sh 负责提权/udev）：
  uinput-tablet.py tap <x> <y> [--button left|right] [--hold-ms N] [--screen WxH]
  uinput-tablet.py move <x> <y> [--screen WxH]   # 悬停移动光标（不点击）

坐标为 niri 逻辑坐标（输出 layout 坐标）；ABS 轴范围即坐标系，默认 1280x800，
多输出/缩放场景用 --screen 传逻辑布局范围。设备每次调用即建即毁（热插拔，
无残留状态）。零第三方依赖（纯 ioctl + struct）。
"""
import argparse
import fcntl
import os
import struct
import sys
import time

# linux/uinput.h
UI_SET_EVBIT = 0x40045564  # _IOW('U', 100, int)
UI_SET_KEYBIT = 0x40045565  # _IOW('U', 101, int)
UI_SET_ABSBIT = 0x40045567  # _IOW('U', 103, int)
UI_DEV_SETUP = 0x405C5503  # _IOW('U', 3, struct uinput_setup)   92B = id(8)+name(80)+ff_max(4)
UI_ABS_SETUP = 0x401C5504  # _IOW('U', 4, struct uinput_abs_setup) 28B = code(2)+pad+absinfo(24)
UI_DEV_CREATE = 0x5501  # _IO('U', 1)
UI_DEV_DESTROY = 0x5502  # _IO('U', 2)

# linux/input-event-codes.h
EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
ABS_X, ABS_Y, ABS_PRESSURE = 0x00, 0x01, 0x18
BTN_TOOL_PEN, BTN_TOUCH, BTN_STYLUS = 0x140, 0x14A, 0x14B
BUS_USB = 0x03

MAX_PRESSURE = 1023
# libinput 要求 tablet 的 X/Y 轴带非零 resolution（单位/毫米），否则整设备拒收
# （"libinput bug: missing tablet capabilities: ... resolution"）。合成器按 [0,1]
# 归一化映射输出，数值本身不影响落点，给个数位板量级即可。
XY_RESOLUTION = 40


def emit(fd, events: list[tuple[int, int, int]]) -> None:
    """写入一批 input_event 后跟一个 SYN_REPORT。64 位平台 input_event=24B。"""
    evs = list(events)
    evs.append((EV_SYN, SYN_REPORT, 0))
    buf = b"".join(
        struct.pack("<qqHHi", 0, 0, etype, code, value) for etype, code, value in evs
    )
    os.write(fd, buf)


def create_tablet(width: int, height: int) -> int:
    """创建虚拟数字化仪，返回 fd。调用方负责 UI_DEV_DESTROY + close。"""
    fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
    for bit in (EV_ABS, EV_KEY):
        fcntl.ioctl(fd, UI_SET_EVBIT, bit)
    for key in (BTN_TOOL_PEN, BTN_TOUCH, BTN_STYLUS):
        fcntl.ioctl(fd, UI_SET_KEYBIT, key)
    for axis in (ABS_X, ABS_Y, ABS_PRESSURE):
        fcntl.ioctl(fd, UI_SET_ABSBIT, axis)

    # 轴参数走 UI_ABS_SETUP（老式 uinput_user_dev 写入没有 resolution 字段）。
    # struct uinput_abs_setup = {u16 code; struct input_absinfo absinfo}：
    # absinfo 首字段是 value（当前值），随后 minimum/maximum/fuzz/flat/resolution。
    def abs_setup(code: int, minimum: int, maximum: int, resolution: int) -> None:
        fcntl.ioctl(
            fd, UI_ABS_SETUP,
            struct.pack("<H2x6i", code, 0, minimum, maximum, 0, 0, resolution),
        )

    abs_setup(ABS_X, 0, width - 1, XY_RESOLUTION)
    abs_setup(ABS_Y, 0, height - 1, XY_RESOLUTION)
    abs_setup(ABS_PRESSURE, 0, MAX_PRESSURE, 1)

    # struct uinput_setup = {struct input_id id; char name[80]; ff_effects_max}
    name = b"AgentOS Virtual Tablet"
    fcntl.ioctl(
        fd, UI_DEV_SETUP,
        struct.pack("<4H80sI",
                    BUS_USB, 0xA605, 0x0A17, 1, name.ljust(80, b"\0"), 0),
    )
    fcntl.ioctl(fd, UI_DEV_CREATE)
    return fd


def tap(fd: fd, x: int, y: int, button: str, hold_ms: int) -> None:
    if button == "right":
        # 数位笔的桶键（barrel button）在接触期间按下 = 右键语义
        barrel = BTN_STYLUS
    else:
        barrel = None
    # 1) 落笔入感应区（proximity）——光标跳到绝对坐标
    emit(fd, [
        (EV_ABS, ABS_X, x),
        (EV_ABS, ABS_Y, y),
        (EV_KEY, BTN_TOOL_PEN, 1),
    ])
    time.sleep(0.04)
    # 2) 笔尖触底 = 按下
    press = [(EV_KEY, BTN_TOUCH, 1), (EV_ABS, ABS_PRESSURE, MAX_PRESSURE)]
    if barrel:
        press.append((EV_KEY, barrel, 1))
    emit(fd, press)
    time.sleep(max(hold_ms, 20) / 1000.0)
    # 3) 抬笔 = 松开；出感应区
    release = [(EV_KEY, BTN_TOUCH, 0), (EV_ABS, ABS_PRESSURE, 0)]
    if barrel:
        release.append((EV_KEY, barrel, 0))
    emit(fd, release)
    time.sleep(0.03)
    emit(fd, [(EV_KEY, BTN_TOOL_PEN, 0)])


def hover(fd, x: int, y: int) -> None:
    emit(fd, [
        (EV_ABS, ABS_X, x),
        (EV_ABS, ABS_Y, y),
        (EV_KEY, BTN_TOOL_PEN, 1),
    ])
    time.sleep(0.05)
    emit(fd, [(EV_KEY, BTN_TOOL_PEN, 0)])


def main() -> int:
    p = argparse.ArgumentParser(description="uinput tablet 绝对坐标指针注入")
    p.add_argument("mode", choices=["tap", "move"])
    p.add_argument("x", type=int)
    p.add_argument("y", type=int)
    p.add_argument("--button", choices=["left", "right"], default="left")
    p.add_argument("--hold-ms", type=int, default=60)
    p.add_argument("--screen", default="1280x800", help="逻辑布局范围 WxH")
    ns = p.parse_args()

    w, h = (int(v) for v in ns.screen.lower().split("x"))
    if not (0 <= ns.x < w and 0 <= ns.y < h):
        print(f"uinput-tablet: 坐标 ({ns.x},{ns.y}) 超出 {w}x{h}", file=sys.stderr)
        return 2

    fd = create_tablet(w, h)
    try:
        time.sleep(0.02)  # 给 uinput/evdev 一点创建完成时间
        if ns.mode == "tap":
            tap(fd, ns.x, ns.y, ns.button, ns.hold_ms)
        else:
            hover(fd, ns.x, ns.y)
    finally:
        fcntl.ioctl(fd, UI_DEV_DESTROY)
        os.close(fd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
