# -*- coding: utf-8 -*-
"""Origin 白名单回归测试（含 Firefox moz-extension://）
运行：py -3.13 tests/test_bridge_origin.py
"""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import browser_bridge
oa = browser_bridge.origin_allowed

CASES = [
    ("", True, "无 Origin（curl/本地工具）"),
    ("null", True, "Origin: null（沙箱 iframe）"),
    ("file://", True, "file 协议（本地页面）"),
    ("chrome-extension://abcdefghijklmnopabcdefghijklmnop", True, "Chrome/Edge 扩展"),
    ("moz-extension://1234abcd-12ab-34cd-56ef-1234567890ab", True, "Firefox 扩展"),
    ("http://127.0.0.1:47531", True, "本机 127.0.0.1"),
    ("http://localhost:47531", True, "本机 localhost"),
    ("https://civitai.red/models/1", False, "C 站网页（应拒）"),
    ("https://evil.example.com", False, "任意外部站（应拒）"),
    ("http://127.0.0.1.evil.com", False, "伪造 127.0.0.1 前缀（应拒）"),
]


def main():
    bad = 0
    for origin, want, name in CASES:
        got = bool(oa(origin))
        if got == want:
            print("  OK   %-34s %r" % (name, origin))
        else:
            print("  FAIL %-34s %r -> %s (期望 %s)" % (name, origin, got, want))
            bad += 1
    print()
    if bad:
        print("%d 项失败" % bad)
        return 1
    print("全部 %d 项通过" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
