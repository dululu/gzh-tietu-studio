#!/bin/bash
# SVG 预览页截图：把 svg输出_*/_预览.html 存成 _预览.png（精确高度，不留白、不截断）
#
# 用法:  ./预览截图.sh [svg输出目录] [宽度] [倍率]
# 默认:  ./预览截图.sh svg输出 1300 1.5
#
# 前置：先跑 `node 导出SVG.js <数据源.json> <svg输出目录>` 生成 _预览.html。
#
# 为什么不手动一条命令跑完：带 --user-data-dir 的截图 Chrome 不会自己退出，
# 一条命令写到最后会被 SIGKILL 挂住（实测报 137）。这里照 总览截图.sh 的做法——
# 后台起进程 + 轮询「文件大小连续两次不变」再强杀。
#
# 探针页必须和 _预览.html 同目录：预览页里 <img src="xxx.svg"> 是相对路径，
# 挪走就全 404、量出来的页高偏小。
#
# 两段式的原因和 批量出图.sh 一样：这台机器上 Node 子进程起不了 Chrome。

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(pwd)"
OUT="${1:-svg输出}"
W="${2:-1300}"
SCALE="${3:-1.5}"
case "$OUT" in /*) OUT_ABS="$OUT" ;; *) OUT_ABS="$WORK/$OUT" ;; esac

[ -f "$OUT_ABS/_预览.html" ] || { echo "找不到 $OUT_ABS/_预览.html —— 先跑 node 导出SVG.js" >&2; exit 1; }

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
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
[ -n "$CHROME" ] || { echo "没找到 Chrome / Edge / Chromium" >&2; exit 1; }

PROBE_FILE="$("$NODE_BIN" "$DIR/总览截图.js" prep "$OUT_ABS" "_预览.html")" || exit 1
[ -f "$PROBE_FILE" ] || { echo "没生成探针页" >&2; exit 1; }
cleanup() { [ -n "${PROBE_FILE:-}" ] && rm -f "$PROBE_FILE"; }
trap cleanup EXIT

echo "== 量页面高度 =="
H=""
EXTRA=""
for pass in 1 2; do
  # 量高必须和截图同宽：宽度决定网格列宽和换行，进而决定页高。
  H="$("$CHROME" --headless=new $EXTRA --disable-gpu --hide-scrollbars \
        --no-first-run --no-default-browser-check --disable-extensions \
        --window-size="$W,800" --virtual-time-budget=6000 \
        --dump-dom "file://$PROBE_FILE" 2>/dev/null \
      | "$NODE_BIN" "$DIR/总览截图.js" parse 2>/dev/null)"
  [ -n "$H" ] && break
  # 受限环境下 Chrome 自身沙箱初始化失败（SIGTRAP、无输出），回退 --no-sandbox。
  EXTRA="--no-sandbox"
done
[ -n "$H" ] || { echo "量不到页面高度" >&2; exit 1; }
echo "  宽 ${W}px  高 ${H}px"

echo ""
echo "== 截图 =="
prof="$(mktemp -d)"
tmp="$OUT_ABS/.pvz-$$-$RANDOM.png"
shot() {
  # shellcheck disable=SC2086
  "$CHROME" --headless=new $1 --disable-gpu --hide-scrollbars \
    --no-first-run --no-default-browser-check --disable-extensions \
    --disable-background-timer-throttling \
    --user-data-dir="$prof" \
    --window-size="$W,$H" --force-device-scale-factor="$SCALE" \
    --virtual-time-budget=9000 \
    --screenshot="$tmp" \
    "file://$OUT_ABS/_预览.html" >/dev/null 2>&1 &
  pid=$!
  last=-1; stable=0
  for _ in $(seq 1 160); do
    if [ -s "$tmp" ]; then
      cur=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
      if [ "$cur" = "$last" ]; then stable=$((stable + 1)); else stable=0; fi
      last="$cur"
      [ "$stable" -ge 2 ] && break
    elif ! kill -0 "$pid" 2>/dev/null; then
      sleep 0.4; break
    fi
    sleep 0.25
  done
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  [ -s "$tmp" ]
}
if ! shot "$EXTRA"; then shot "--no-sandbox"; fi
rm -rf "$prof"

if [ -s "$tmp" ]; then
  mv -f "$tmp" "$OUT_ABS/_预览.png"
  echo "  _预览.png   $(( $(stat -f%z "$OUT_ABS/_预览.png") / 1024 )) KB"
  sips -g pixelWidth -g pixelHeight "$OUT_ABS/_预览.png" 2>/dev/null | tail -2 | tr -d ' ' | paste -sd' ' -
  echo "  →  $OUT_ABS/_预览.png"
else
  echo "  失败：没产出截图" >&2
  exit 1
fi
