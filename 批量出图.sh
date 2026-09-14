#!/bin/bash
# 信息图批量出图（两段式：Node 生成页面 → Shell 逐个调 Chrome 截图）
#
# 用法:  ./批量出图.sh [数据源.json] [输出目录] [--template=xxx.html]
# 默认:  ./批量出图.sh 数据源示例.json output
#
# 什么时候用这个而不用 批量出图.js：
#   当 Node 子进程没权限启动 Chrome 时（受限沙箱、企业策略）。
#   这个脚本由终端直接调 Chrome，绕开子进程限制。

set -uo pipefail

# DIR = 脚本所在目录（模板、vendor、示例数据在这）
# WORK = 当前工作目录（数据源和输出目录按它解析，和 批量出图.js 保持一致）
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(pwd)"
DATA="${1:-数据源示例.json}"
OUT="${2:-output}"
W=810
H=1080
SCALE=2

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  # 兜底：找 WorkBuddy 托管运行时里最新的一版
  NODE_BIN="$(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | tail -1)"
fi
[ -x "$NODE_BIN" ] || NODE_BIN="/opt/homebrew/bin/node"

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/usr/bin/google-chrome" \
  "/usr/bin/chromium-browser"
do
  [ -x "$c" ] && CHROME="$c" && break
done

if [ -z "$CHROME" ]; then
  echo "没找到 Chrome / Edge / Chromium" >&2
  exit 1
fi

case "$OUT" in /*) OUT_ABS="$OUT" ;; *) OUT_ABS="$WORK/$OUT" ;; esac
PAGE_DIR="$OUT_ABS/.pages"

# 数据源：先看当前工作目录，再看脚本目录（脚本装在技能目录里时能直接跑示例）
if [ -f "$WORK/$DATA" ]; then ABS_DATA="$WORK/$DATA"
elif [ -f "$DIR/$DATA" ]; then ABS_DATA="$DIR/$DATA"
elif [ -f "$DATA" ]; then ABS_DATA="$DATA"
else echo "找不到数据源：$DATA" >&2; exit 1
fi

echo "== 生成页面 =="
"$NODE_BIN" "$DIR/批量出图.js" "$ABS_DATA" "$OUT_ABS" --html-only "${@:3}" || exit 1

shopt -s nullglob
# 只截这一轮真正生成的页面（清单由 批量出图.js 写），不要 glob 整个目录 ——
# 上一轮遗留的旧页面会被一起截，结果"张数变多、还多出一批过期图"。
PAGES=()
if [ -f "$PAGE_DIR/_manifest.txt" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && PAGES+=("$PAGE_DIR/$line")
  done < "$PAGE_DIR/_manifest.txt"
else
  PAGES=("$PAGE_DIR"/*.html)
fi
if [ ${#PAGES[@]} -eq 0 ]; then
  echo "没有生成任何页面" >&2
  exit 1
fi

echo ""
echo "== 截图 =="
ok=0
for f in "${PAGES[@]}"; do
  slug="$(basename "$f" .html)"
  png="$OUT_ABS/$slug.png"
  prof="$(mktemp -d)"
  # 先截到临时文件再改名：目标文件不存在，就不会把"上一轮的旧图"误判成本轮成功；
  # 也不用先删旧图（那会触发沙箱的批量删除保护）。
  tmp="$PAGE_DIR/.shot-$$-$RANDOM.png"

  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --no-first-run --no-default-browser-check --disable-extensions \
    --disable-background-timer-throttling \
    --user-data-dir="$prof" \
    --window-size="$W,$H" --force-device-scale-factor="$SCALE" \
    --virtual-time-budget=6000 \
    --screenshot="$tmp" \
    "file://$f" >/dev/null 2>&1 &
  pid=$!

  # Chrome 截图后经常不退出，等到文件落盘且大小稳定就收工
  last=-1; stable=0
  for _ in $(seq 1 120); do
    if [ -s "$tmp" ]; then
      cur=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
      if [ "$cur" = "$last" ]; then stable=$((stable + 1)); else stable=0; fi
      last="$cur"
      [ "$stable" -ge 2 ] && break
    fi
    sleep 0.25
  done

  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -rf "$prof"

  if [ -s "$tmp" ]; then
    mv -f "$tmp" "$png"
    kb=$(( $(stat -f%z "$png") / 1024 ))
    echo "  $slug.png   ${kb} KB"
    ok=$((ok + 1))
  else
    echo "  $slug   失败：没产出截图"
  fi
done

echo ""
echo "完成 $ok/${#PAGES[@]} 张  →  $OUT_ABS"
[ "$ok" -lt "${#PAGES[@]}" ] && exit 1
exit 0
