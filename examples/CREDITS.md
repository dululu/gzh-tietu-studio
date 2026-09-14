# 示例图片来源与许可

`examples/img/` 和 `examples/预览/` 里的图片**不是本仓库的原创内容**，版权归原摄影者/机构所有。
下面逐张列出作者、许可、原页。**转载或再使用这些图，请自行遵守各自的许可条款**（多数要求署名）。

> 本仓库的**代码**是 MIT，但那不覆盖这些图片——两者是分开的。

## 维基共享资源（Wikimedia Commons）

| 本地文件 | 作者 | 许可 | 原页 |
|---|---|---|---|
| `Brain-computer_interface_experiment.jpg` | Laurens R. Krol | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [File:Brain-computer interface experiment.jpg](https://commons.wikimedia.org/wiki/File:Brain-computer_interface_experiment.jpg) |
| `EEG_Recording_Cap.jpg` | Chris Hope | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [File:EEG Recording Cap.jpg](https://commons.wikimedia.org/wiki/File:EEG_Recording_Cap.jpg) |
| `Semiconductor_Wafer_of_Microelectronics.jpg` | DrHughManning | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [File:Semiconductor Wafer of Microelectronics.jpg](https://commons.wikimedia.org/wiki/File:Semiconductor_Wafer_of_Microelectronics.jpg) |
| `TOPIO_3_3.jpg` | Humanrobo | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [File:TOPIO 3 3.JPG](https://commons.wikimedia.org/wiki/File:TOPIO_3_3.JPG) |
| `Virginia_Tech_-_data_center.jpg` | Christopher Bowns | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) | [File:Virginia Tech - data center.jpg](https://commons.wikimedia.org/wiki/File:Virginia_Tech_-_data_center.jpg) |
| `Ai-Da_Solo_Exhibition_at_the_United_Nations.jpg` | Aneonv36 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [File:Ai-Da Solo Exhibition at the United Nations.jpg](https://commons.wikimedia.org/wiki/File:Ai-Da_Solo_Exhibition_at_the_United_Nations.jpg) |
| `RoboSub_diver.jpg` | Rick Naystatt（美国海军） | 公有领域 | [File:14th Annual International RoboSub Competition 110713-N-UN340-007.jpg](https://commons.wikimedia.org/wiki/File:14th_Annual_International_RoboSub_Competition_110713-N-UN340-007.jpg) |
| `Clean_room.jpg` | Duk（上传者） | 公有领域 | [File:Clean room.jpg](https://commons.wikimedia.org/wiki/File:Clean_room.jpg) |

## NASA

| 本地文件 | 作者 | 许可 | 说明 |
|---|---|---|---|
| `NASA_iss071e361950.jpg` | NASA | 公有领域 | NASA 图片绝大多数为公有领域，署名写 `NASA` 或 `NASA/JSC` 即可 |

## Pexels

Pexels 许可：可商用、**免署名（但建议标）**；**不得转售原图**、**不得暗示照片中的人为你或某机构背书**。
详见 <https://www.pexels.com/license/>。

| 本地文件 | 摄影者 | 原页 |
|---|---|---|
| `Pexels_8199659.jpg` | Yan Krukau | <https://www.pexels.com/photo/students-studying-inside-the-library-8199659/> |
| `Pexels_8439008.jpg` | Pavel Danilyuk | <https://www.pexels.com/photo/a-man-and-a-woman-wearing-white-coats-and-protective-goggles-8439008/> |

## 贴图里怎么署名

署名写进数据的 `foot` 字段，它会渲染在图片底部：

```json
"foot": [
  "图片：维基共享资源 · Chris Hope / Laurens R. Krol / DrHughManning / Humanrobo",
  "许可：CC BY 2.0 / CC BY 4.0 / CC BY-SA 3.0 / CC BY-SA 4.0（另 2 张公有领域）"
]
```

- CC BY / CC BY-SA **必须署名作者**；CC0 / 公有领域不强制（可以「另 N 张公有领域」带过）。
- 图多的时候只列必须署名的，许可名合并成一组——不然 `foot` 会涨到四行、把内容区顶小。
- **CC BY-SA 的图严格说不能随便裁剪**：「相同方式共享」意味着裁一刀就算改编，改编稿要以同样许可发布。
  能选就优先 CC BY / CC0 / 公有领域；只用 BY-SA 时照常裁剪 + 完整署名（行业通例，属灰色地带）；
  商业投放、品牌稿改走 Pexels 或自采图。

## 预览图

`examples/预览/九种版式总览.jpg` 和 `examples/预览/热点贴图总览.jpg` 是本工具的输出示例，
里面包含上面这些图片。它们同样受上表的许可约束。
