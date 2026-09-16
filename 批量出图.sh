#!/bin/bash
# 信息图批量出图（两段式：Node 生成页面 → Shell 并发调 Chrome 截图 + 体检）
#
# 用法:  ./批量出图.sh [数据源.json] [输出目录] [--template=xxx.html]
# 默认:  ./批量出图.sh 数据源示例.json output
#
# 环境变量:
#   JOBS=4   同时开几个 Chrome（默认按核数，最多 6）
#
# 什么时候用这个而不用 批量出图.js：
#   当 Node 子进程没权限启动 Chrome 时（受限沙箱、企业策略）。
#   这个脚本由终端直接调 Chrome，绕开子进程限制。
#
# 为什么快：
#   ① 一趟 Chrome 同时给 --screenshot 和 --dump-dom —— 溢出检查与真图清点
#      搭出图这趟车，不再各起一趟（6 张图光校验就省掉 21s）；
#   ② 多张并行，不再一张一张等；
#   ③ 要不要 --no-sandbox 只探一次，结果记在 .pages/.chrome-extra 里。

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

# 并发度：按核数取，但不超过 6（再多就是互相抢 CPU，墙钟时间反而更长）
CORES="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
JOBS="${JOBS:-$CORES}"
[ "$JOBS" -gt 6 ] && JOBS=6
[ "$JOBS" -lt 1 ] && JOBS=1

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
DUMP_DIR="$PAGE_DIR/.dumps"
EXTRA_FILE="$PAGE_DIR/.chrome-extra"

# 数据源：先看当前工作目录，再看脚本目录（脚本装在技能目录里时能直接跑示例）
if [ -f "$WORK/$DATA" ]; then ABS_DATA="$WORK/$DATA"
elif [ -f "$DIR/$DATA" ]; then ABS_DATA="$DIR/$DATA"
elif [ -f "$DATA" ]; then ABS_DATA="$DATA"
else echo "找不到数据源：$DATA" >&2; exit 1
fi

echo "== 生成页面 =="
"$NODE_BIN" "$DIR/批量出图.js" "$ABS_DATA" "$OUT_ABS" --html-only "${@:3}" || exit 1

mkdir -p "$DUMP_DIR"

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

# ── 这台机器上 Chrome 要不要 --no-sandbox，只探一次 ──
# 受限环境里 Chrome 自身沙箱起不来（SIGTRAP、零产出，看着像"没出图"）。
# 结论存进 .chrome-extra，之后每张图、每次运行都直接带着，不再白跑一轮。
EXTRA=""
if [ -f "$EXTRA_FILE" ]; then
  EXTRA="$(cat "$EXTRA_FILE")"
else
  probe_prof="$(mktemp -d)"
  # 用 `{ ...; } 2>/dev/null` 包一层：Chrome 自身沙箱起不来时会带信号退出，而报
  # "Trace/BPT trap" 的是**执行它的那个 shell**，命令末尾的 2>&1 拦不住（shell 是在
  # 重定向撤销之后才打印的）。注意别写成 `( cmd ) 2>/dev/null` —— 单命令的子 shell
  # 会被 bash 优化掉、根本没 fork，重定向照样不生效。
  if { "$CHROME" --headless=new --disable-gpu --user-data-dir="$probe_prof" \
         --dump-dom about:blank >/dev/null 2>&1; } 2>/dev/null; then
    EXTRA=""
  else
    EXTRA="--no-sandbox"
  fi
  rm -rf "$probe_prof"
  printf '%s' "$EXTRA" > "$EXTRA_FILE"
fi

# 截一张，并顺手把体检指标捎回来（指标由 度量.js 的探针写进 <title>，--dump-dom 带回）。
# $1 = 页面路径。结果落在 $OUT_ABS/<slug>.png 与 $DUMP_DIR/<slug>.html。
shoot_one() {
  local f="$1" slug png dump prof tmp pid last stable cur grace
  slug="$(basename "$f" .html)"
  png="$OUT_ABS/$slug.png"
  dump="$DUMP_DIR/$slug.html"

  prof="$(mktemp -d)"
  tmp="$PAGE_DIR/.shot-$$-$RANDOM.png"
  rm -f "$tmp"
  : > "$dump"

  # 截到临时名再改名：目标文件不存在，就不会把"上一轮的旧图"误判成本轮成功；
  # 也不用先删旧图（那会触发沙箱的批量删除保护）。
  run() {
    "$CHROME" --headless=new $1 --disable-gpu --hide-scrollbars \
      --no-first-run --no-default-browser-check --disable-extensions \
      --disable-background-timer-throttling \
      --user-data-dir="$prof" \
      --window-size="$W,$H" --force-device-scale-factor="$SCALE" \
      --virtual-time-budget=6000 \
      --screenshot="$tmp" --dump-dom "file://$f" > "$dump" 2>/dev/null &
    pid=$!
  }

  wait_shot() {
    last=-1; stable=0; grace=0
    for _ in $(seq 1 120); do
      if [ -s "$tmp" ]; then
        cur=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
        if [ "$cur" = "$last" ]; then stable=$((stable + 1)); else stable=0; fi
        last="$cur"
        if [ "$stable" -ge 2 ]; then
          # 图落盘稳定，且 DOM 也写完了（探针指标在 <title> 里）才算收工；
          # DOM 迟迟不完整时最多再等 3s，别死等 30s。
          if tail -c 24 "$dump" 2>/dev/null | grep -q '</html>'; then break; fi
          grace=$((grace + 1))
          [ "$grace" -ge 12 ] && break
        fi
      elif ! kill -0 "$pid" 2>/dev/null; then
        # 进程已经退场且没有产物时要立刻收工——否则一张图白等 30 秒
        sleep 0.4
        break
      fi
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    [ -s "$tmp" ]
  }

  run "$EXTRA"
  if ! wait_shot; then
    run "--no-sandbox"
    printf '%s' "--no-sandbox" > "$EXTRA_FILE"
    wait_shot
  fi

  rm -rf "$prof"
  if [ -s "$tmp" ]; then mv -f "$tmp" "$png"; else rm -f "$tmp" "$dump"; fi
}

echo ""
echo "== 截图 + 体检（并发 ${JOBS}）=="
start=$(date +%s)

# 分批并行：macOS 自带的是 bash 3.2，没有 `wait -n`，所以按批起、按批等。
batch=()
flush() {
  if [ ${#batch[@]} -gt 0 ]; then
    local x
    for x in "${batch[@]}"; do shoot_one "$x" & done
    wait
    batch=()
  fi
}
for f in "${PAGES[@]}"; do
  batch+=("$f")
  [ ${#batch[@]} -ge "$JOBS" ] && flush
done
flush
end=$(date +%s)

echo ""
"$NODE_BIN" "$DIR/检查溢出.js" from-dumps "$OUT_ABS"
rc=$?

echo ""
echo "用时 $((end - start))s   →  $OUT_ABS"
exit $rc
