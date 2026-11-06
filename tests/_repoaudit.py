"""验证公开仓库的凭证卫生：已提交版本里不能出现真实 endpoint / key。"""
import subprocess
import sys
import os

GIT = r"C:\Program Files\Git\cmd\git.exe"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REAL_ENDPOINT = "menulens.app.workbuddy.host"
REAL_KEY_PREFIX = "wbpk_UL1l9"


def run(*args):
    return subprocess.run([GIT] + list(args), cwd=REPO,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace").stdout


def check_file_at_head(path):
    """检查 HEAD 里某个文件的已提交内容"""
    content = run("show", "HEAD:" + path)
    hits = []
    if REAL_ENDPOINT in content:
        hits.append("真实 endpoint")
    if REAL_KEY_PREFIX in content:
        hits.append("真实 publishableKey 前缀")
    return hits


def main():
    lines = []
    ok = True

    # 1. 当前提交
    head = run("log", "-1", "--oneline").strip()
    lines.append("HEAD = " + head)

    # 2. 凭证文件必须是占位值
    cfg_path = "miniprogram/utils/cloud-config.js"
    content = run("show", "HEAD:" + cfg_path)
    if not content.strip():
        lines.append("FAIL 读不到 " + cfg_path)
        ok = False
    else:
        hits = check_file_at_head(cfg_path)
        if hits:
            lines.append("FAIL cloud-config.js 含真实凭证: " + "、".join(hits))
            ok = False
        else:
            lines.append("PASS cloud-config.js 已提交版本为占位值")
        if "YOUR_PUBLISHABLE_KEY" not in content and "YOUR-ENDPOINT" not in content:
            lines.append("WARN cloud-config.js 里没看到占位字符串")

    # 3. 全历史扫描真实 key
    log_out = run("log", "--all", "-p", "-S", REAL_KEY_PREFIX, "--oneline")
    if log_out.strip():
        lines.append("FAIL 版本历史里出现过真实 key: " + log_out.strip().splitlines()[0])
        ok = False
    else:
        lines.append("PASS 版本历史无真实 key")

    log_out = run("log", "--all", "-p", "-S", REAL_ENDPOINT, "--oneline")
    if log_out.strip():
        lines.append("WARN 历史里出现过真实域名（" + str(len(log_out.strip().splitlines())) + " 行 diff）")
    else:
        lines.append("PASS 版本历史无真实域名")

    # 4. .git/config 不能带 token
    cfg = ""
    p = os.path.join(REPO, ".git", "config")
    if os.path.exists(p):
        with open(p, encoding="utf-8", errors="replace") as f:
            cfg = f.read()
    if "extraheader" in cfg.lower() or "gho_" in cfg or "@github.com/" in cfg:
        lines.append("FAIL .git/config 里有凭证痕迹")
        ok = False
    else:
        lines.append("PASS .git/config 干净")

    # 5. 工作区云端是否可用（不影响结论，仅信息）
    wk = ""
    wk_path = os.path.join(REPO, cfg_path)
    if os.path.exists(wk_path):
        with open(wk_path, encoding="utf-8", errors="replace") as f:
            wk = f.read()
    lines.append("工作区 cloud-config.js: " +
                 ("已填真实值（skip-worktree 保护）" if REAL_KEY_PREFIX in wk else "仍是占位值"))

    # 6. skip-worktree 状态
    sw = run("ls-files", "-v", cfg_path).strip()
    lines.append("skip-worktree 标记: " + (sw[:1] if sw else "(无)"))

    lines.append("")
    lines.append("RESULT: " + ("ALL PASS" if ok else "FAIL"))
    text = "\n".join(lines)
    print(text)
    sys.exit(0 if ok else 1)


main()
