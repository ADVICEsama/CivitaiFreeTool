import sys
try:
    import webview
    print("webview OK", webview.__file__)
except Exception as e:
    print("FAIL:", repr(e))
