# -*- coding: utf-8 -*-
"""Windows 11 Mica / Acrylic 窗口背景效果（DWM API，纯 ctypes）
支持 Win11 22000+；不支持的系统静默回退经典样式。"""
import ctypes
import sys

_DWMWA_SYSTEMBACKDROP_TYPE = 38
_DWMWA_USE_IMMERSIVE_DARK_MODE = 20
# DWMSBT_MAINWINDOW=2 (Mica), DWMSBT_TRANSIENTWINDOW=4 (Acrylic)
_DWMSBT = {"mica": 2, "acrylic": 4}


def is_win11():
    try:
        return sys.getwindowsversion().build >= 22000
    except Exception:
        return False


def _set_attr(hwnd, attr, value):
    try:
        # Tk 顶层可能是 child HWND，DWM 属性作用于真正顶层
        try:
            hwnd = ctypes.windll.user32.GetAncestor(hwnd, 2)
        except Exception:
            pass
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(hwnd), attr,
            ctypes.byref(ctypes.c_int(value)), ctypes.sizeof(ctypes.c_int))
        return True
    except Exception:
        return False


def apply_backdrop(hwnd, style):
    """style: 'mica' | 'acrylic' | 'none'。返回是否生效。"""
    if style == "none" or not is_win11():
        return False
    value = _DWMSBT.get(style)
    if value is None:
        return False
    return _set_attr(hwnd, _DWMWA_SYSTEMBACKDROP_TYPE, value)


def apply_dark_titlebar(hwnd, dark=True):
    return _set_attr(hwnd, _DWMWA_USE_IMMERSIVE_DARK_MODE, 1 if dark else 0)
