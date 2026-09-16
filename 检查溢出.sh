#!/bin/bash
# 出图后回读校验：逐张量"内容区放不放得下"。
#
# 用法:  ./检查溢出.sh 输出目录
#        先跑一次 批量出图.sh，再跑这个。正常应该每张都是"✅ 放得下"。
#
# 为什么需要它：模板给内容区的高度是定死的（标题 + 副标题 + 页脚先占位），
# 内容元素一多（典型是 duo 的双主体图 + 金句 + 四宫格）就会顶出去，
# 超出的部分盖在页脚上。光看图很难发现，量 scrollHeight 就很明确。
#
# 两段式的原因和 批量出图.sh 一样：这台机器上 Node 子进程起不了 Chrome。

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(pwd)"
OUT="${1:-output}"
case "$OUT" in /*) OUT_ABS="$OUT" ;; *) OUT_ABS="$WORK/$OUT" ;; esac

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

# 出图那趟已经把体检指标捎回来了（.pages/.dumps/），直接读就行——**一次 Chrome 都不启**。
if [ -d "$OUT_ABS/.pages/.dumps" ]; then
  "$NODE_BIN" "$DIR/检查溢出.js" from-dumps "$OUT_ABS"
  exit $?
fi

# 没有缓存（页面不是走出图流程生成的）才回退到探针：临时给页面注入度量脚本，再逐张量。
PROBE_DIR="$("$NODE_BIN" "$DIR/检查溢出.js" prep "$OUT_ABS")" || exit 1
[ -n "$PROBE_DIR" ] || exit 1

bad=0
total=0
for f in "$PROBE_DIR"/*.html; do
  [ -e "$f" ] || continue
  total=$((total + 1))
  printf '%-44s' "$(basename "$f" .html)"
  line="$("$CHROME" --headless=new --no-sandbox --disable-gpu \
      --virtual-time-budget=4000 --dump-dom "file://$f" 2>/dev/null \
    | "$NODE_BIN" "$DIR/检查溢出.js" parse)"
  echo "$line"
  case "$line" in *溢出*) bad=$((bad + 1)) ;; esac
done

rm -rf "$PROBE_DIR"
echo ""
if [ "$bad" -eq 0 ]; then
  echo "全部放得下（$total 张）"
else
  echo "有 $bad/$total 张放不下：把内容改短一点（页脚少一行、金句短一点），或换版式"
fi
[ "$bad" -eq 0 ]
