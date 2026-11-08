"""验证公开仓库的凭证卫生：已提交版本里不能出现真实 endpoint / key。

凭证真值从工作区 cloud-config.js 运行时读取，本脚本不存任何真实片段。

为什么这么写：早期版本把 key 前缀硬编码成常量，再用 git log -S 去扫历史。
结果脚本自己被提交时，那一行常量就进了版本历史，-S 扫到自己，审计从此
永久 FAIL——而真实凭证从没泄漏过。判据必须是运行时从工作区读出的完整值。
"""
import os
import re
import subprocess
import sys

GIT = r"C:\Program Files\Git\cmd\git.exe"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = "miniprogram/utils/cloud-config.js"


def run(*args):
    return subprocess.run([GIT] + list(args), cwd=REPO,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace").stdout


def read_worktree_cfg():
    """从工作区 cloud-config.js 抽真实值。工作区存真值才能跑通云端，
    入库版本存占位值，两者靠 skip-worktree 分离。"""
    path = os.path.join(REPO, CFG)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    out = {}
    m = re.search(r"endpoint\s*:\s*['\"]([^'\"]*)['\"]", text)
    if m:
        out["endpoint"] = m.group(1)
    m = re.search(r"publishableKey\s*:\s*['\"]([^'\"]*)['\"]", text)
    if m:
        out["key"] = m.group(1)
    return out


def is_placeholder(v):
    if not v:
        return True
    up = v.upper()
    return ("YOUR" in up) or ("REPLACE" in up) or ("PLACEHOLDER" in up)


def main():
    lines = []
    ok = True

    head = run("log", "-1", "--oneline").strip()
    lines.append("HEAD = " + head)

    real = read_worktree_cfg()
    real_key = real.get("key", "")
    real_endpoint = real.get("endpoint", "")
    has_real = not is_placeholder(real_key) and not is_placeholder(real_endpoint)

    if not has_real:
        lines.append("SKIP 工作区 cloud-config.js 是占位值，无从比对真实凭证")
        lines.append("     克隆到的新机器上这是正常状态，审计只做结构性检查")

    # 1. 已提交的 cloud-config.js 必须是占位值
    committed = run("show", "HEAD:" + CFG)
    if not committed.strip():
        lines.append("FAIL 读不到 " + CFG)
        ok = False
    else:
        bad = []
        if has_real and real_key and real_key in committed:
            bad.append("完整 publishableKey")
        if has_real and real_endpoint and real_endpoint in committed:
            bad.append("真实 endpoint")
        if bad:
            lines.append("FAIL 已提交的 cloud-config.js 含真实凭证: " + "、".join(bad))
            ok = False
        else:
            lines.append("PASS 已提交的 cloud-config.js 是占位值")
            if "YOUR" not in committed.upper():
                lines.append("WARN 没看到 YOUR_* 占位串，确认占位写法是否清晰")

    # 2. HEAD 树内精确扫描完整真实值
    #    用 git grep -F 做固定串匹配，避免正则把测试用的假 key 也算成真
    if has_real:
        for label, value in (("publishableKey", real_key), ("endpoint", real_endpoint)):
            if not value:
                continue
            hits = run("grep", "-l", "-F", "--", value, "HEAD").strip()
            files = [x.split(":", 1)[-1] for x in hits.splitlines() if x.strip()]
            # cloud-config.js 若含真值已被第 1 步拦下，这里排除它避免重复报
            files = [f for f in files if not f.endswith("cloud-config.js")]
            if files:
                lines.append("FAIL HEAD 里含真实 %s: %s" % (label, "、".join(files)))
                ok = False
        if ok:
            lines.append("PASS HEAD 树内无真实凭证")

    # 3. 全历史扫描：只认完整真实值
    #    用完整 key 而非前缀——前缀会命中审计脚本自身、SDK 注释、测试假值
    if has_real and real_key:
        hist = run("log", "--all", "-S", real_key, "--oneline").strip()
        if hist:
            first = hist.splitlines()[0]
            lines.append("FAIL 版本历史里出现过完整真实 key: " + first)
            ok = False
        else:
            lines.append("PASS 版本历史无完整真实 key")

    # 4. .git/config 不能带推送凭证
    cfg_path = os.path.join(REPO, ".git", "config")
    cfg = ""
    if os.path.exists(cfg_path):
        with open(cfg_path, encoding="utf-8", errors="replace") as f:
            cfg = f.read()
    if "extraheader" in cfg.lower() or "gho_" in cfg or "@github.com/" in cfg:
        lines.append("FAIL .git/config 里有凭证痕迹")
        ok = False
    else:
        lines.append("PASS .git/config 干净")

    # 5. skip-worktree 是否还在保护本地真值
    if has_real:
        sw = run("ls-files", "-v", CFG).strip()
        if sw.startswith("S"):
            lines.append("PASS skip-worktree 生效，本地真值不会被提交")
        else:
            lines.append("FAIL skip-worktree 未生效，下次提交会带上真实凭证")
            ok = False
    else:
        lines.append("INFO 工作区是占位值，无需 skip-worktree")

    # 6. 自检：本脚本不得含任何 key 前缀字面量
    #    就是这条坑把审计弄成永久失败的，留个哨兵。
    #    检测串在运行时拼接，否则这个检查自己就会踩中自己。
    marker = "wbpk" + "_"
    with open(os.path.abspath(__file__), encoding="utf-8", errors="replace") as f:
        if marker in f.read():
            lines.append("FAIL 审计脚本自身含 key 前缀字面量，会污染历史扫描")
            ok = False
        else:
            lines.append("PASS 审计脚本自身不含凭证片段")

    lines.append("")
    lines.append("RESULT: " + ("ALL PASS" if ok else "FAIL"))
    print("\n".join(lines))
    sys.exit(0 if ok else 1)


main()
