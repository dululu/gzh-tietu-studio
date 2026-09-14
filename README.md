# 公众号贴图工坊 · gzh-tietu-studio

一份 JSON 数据，批量产出 **810×1080（精确 3:4）** 的公众号贴图 / 信息图。

同一套骨架（水彩底 + 白色圆角卡片 + 双行主标题 + 账号角标 + 来源注释），**只换内容区**——
所以做 9 种版式不需要写 9 个模板，改一个字段就切换。

- **9 种版式**：单数字冲击 / 编号清单 / 左右对比 / 时间轴 / 双轴柱线图 / 横向条形 / 单图 / 圆形焦点 / 双主体+四宫格
- **5 套配色**：蓝白 / 中国红 / 墨绿 / 暖橙 / 墨黑
- **三路输出**：PNG（发布用，2 倍图）/ SVG（拖进 Figma 二次设计）/ 九宫格总览（批量自查）
- **自动配图**：维基共享资源 + NASA + Pexels，下载时自动打印作者与许可
- **零 npm 依赖**：只用 Node 内置模块 + 系统自带 `sips` + 本机 Chrome

## 效果预览

九种版式（同一套骨架，只换内容区）——见 [`examples/预览/九种版式总览.jpg`](examples/预览/九种版式总览.jpg)

![九种版式总览](examples/预览/九种版式总览.jpg)

一批真实热点（含配图、四宫格图片版）——见 [`examples/预览/热点贴图总览.jpg`](examples/预览/热点贴图总览.jpg)

![热点贴图总览](examples/预览/热点贴图总览.jpg)

## 30 秒上手

```bash
git clone <本仓库>
cd gzh-tietu-studio

# 用示例数据跑一遍，输出到 out/
./批量出图.sh examples/数据-九种版式示例.json out

# 打开 out/_总览.png 一眼看完 9 张
```

做自己的图：复制 `examples/数据-九种版式示例.json`，改成你的内容。

```bash
./批量出图.sh 我的数据.json 输出目录        # 批量出 PNG（2 倍图 1620×2160）
node 导出SVG.js 我的数据.json svg输出       # 导出可编辑 SVG，拖进 Figma
node 生成总览.js 我的数据.json 输出目录 "标题"  # 九宫格总览
```

最小可用数据（一张图 = 一个对象）：

```json
[
  {
    "name": "01_高校专业大洗牌_单数字_中国红",
    "layout": "stat",
    "theme": "red",
    "badge": "小铭想",
    "title1": "高校专业大洗牌",
    "title2": "五年撤掉一万两千个",
    "deck": "撤销的专业，第一次多过新增的",
    "statValue": "1.22",
    "statUnit": "万个",
    "statLabel": "「十四五」期间撤销或停招的本科专业布点",
    "statSubs": ["同期新增布点 1.02 万个", "2026 年调整比例首次突破 10%"],
    "foot": ["数据来源：教育部高等教育司"]
  }
]
```

## 配图

`photo` / `photoFocus` / `duo` 三个版式要图，`duo` 的四宫格图可选。图源全部免费可商用：

```bash
node 找图.js search "humanoid robot" 8      # 维基共享资源 · 全文搜
node 找图.js cat "Humanoid robots" 8        # 维基共享资源 · 按分类，更准
node 找图.js get "File:xxx.jpg" img 1600    # 下载到 img/，打印作者/许可/原页
node 找图.js nasa "mars rover" 8            # NASA 图库（公有领域）
node 找图.js nasa-get "PIA07081" img 1600
node 找图.js pexels "campus library" 8      # Pexels（需 key，现代实拍感最好）
node 找图.js pexels-get "8199659" img 1600
```

Pexels 的 key 不写进脚本，按顺序找：环境变量 `PEXELS_API_KEY` → `~/.workbuddy/pexels.key` → 项目内 `.pexels-key`。

**署名是使用条件，不是礼貌**：CC BY / CC BY-SA 必须署名作者，CC0 / 公有领域不强制。
具体规则和三个图源的取舍见 [`docs/说明书.md`](docs/说明书.md) 第四节。

## 目录结构

```
gzh-tietu-studio/
├── SKILL.md                  # 作为 WorkBuddy 技能使用时的入口说明
├── 贴图模板.html              # 模板本体（浏览器打开就是设计台，可切版式/配色）
├── 主题.js                    # 5 套配色（HTML 与 SVG 共用）
├── 批量出图.js / 批量出图.sh   # 批量出 PNG
├── 导出SVG.js                 # 导出可编辑 SVG（图片 base64 内嵌）
├── 找图.js                    # 维基共享 / NASA / Pexels 取图
├── 生成总览.js                # 九宫格总览页
├── vendor/echarts.min.js      # 图表版式依赖，别删
├── docs/
│   ├── 说明书.md              # ★ 完整中文说明书
│   └── 贴图排版手册.md         # 排版原理、骨架常量、12 个坑
└── examples/
    ├── 数据-九种版式示例.json
    ├── 数据-热点示例.json
    ├── CREDITS.md             # 示例图片的作者 / 许可 / 原页
    ├── img/                   # 示例配图
    └── 预览/                  # 输出预览图
```

## 环境要求

| 依赖 | 说明 |
|---|---|
| Node.js | ≥ 16 即可，无 npm 依赖 |
| Chrome / Edge / Chromium | 无头截图（脚本自动探测常见路径） |
| macOS `sips` | 图片压缩；非 macOS 自动跳过，功能不受影响 |

## 许可

代码：MIT（见 `LICENSE`）。
`examples/img/` 与 `examples/预览/` 里的图片来自维基共享资源、NASA、Pexels，
版权归原摄影者所有，各自许可见 [`examples/CREDITS.md`](examples/CREDITS.md)——**转载示例图请自行遵守原许可**。
