"""修复后的完整发布入口；认证信息不落盘。"""
from release_verified import main

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('发布未完成:', type(error).__name__, str(error)[:200])
        raise SystemExit(1)
