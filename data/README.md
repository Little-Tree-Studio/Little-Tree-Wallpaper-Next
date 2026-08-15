# 中国传统颜色数据使用文档

`zhongguose-colors.json` 收录了 526 条中国传统颜色数据，包含颜色名称、拼音、HEX 和 RGB 值。

## 数据来源

- 网站：[中国色](https://zhongguose.com/)
- 原始数据：[colors.json](https://zhongguose.com/colors.json)
- 本地文件：`data/zhongguose-colors.json`

本地数据仅保留常用字段，并将 HEX 字母统一转换为大写。使用或再分发前，请自行确认来源网站的版权、署名和许可要求。

## 数据结构

文件根节点是一个 JSON 数组，每个元素代表一种颜色：

```json
{
  "name": "乳白",
  "pinyin": "rubai",
  "hex": "#F9F4DC",
  "rgb": [249, 244, 220]
}
```

| 字段 | 类型 | 示例 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | `"乳白"` | 中文颜色名称 |
| `pinyin` | `string` | `"rubai"` | 不含声调和分隔符的小写拼音 |
| `hex` | `string` | `"#F9F4DC"` | 以 `#` 开头的六位大写 HEX 颜色值 |
| `rgb` | `[number, number, number]` | `[249, 244, 220]` | 依次为红、绿、蓝通道，范围均为 `0-255` |

颜色名称和 HEX 值在当前数据集中唯一。拼音不保证唯一，因为不同颜色名称可能同音。

## JavaScript / TypeScript

在 Node.js 中从仓库根目录读取：

```ts
import { readFile } from 'node:fs/promises';

interface ChineseColor {
  name: string;
  pinyin: string;
  hex: string;
  rgb: [number, number, number];
}

const content = await readFile('data/zhongguose-colors.json', 'utf8');
const colors = JSON.parse(content) as ChineseColor[];

const color = colors.find((item) => item.name === '乳白');
console.log(color?.hex); // #F9F4DC
```

按中文名、拼音或 HEX 查询：

```ts
const query = 'rubai'.toLowerCase();

const result = colors.find((color) =>
  color.name === query ||
  color.pinyin === query ||
  color.hex.toLowerCase() === query,
);
```

转换为 CSS RGB 值：

```ts
const cssRgb = `rgb(${color.rgb.join(' ')})`;
// rgb(249 244 220)
```

### 在前端中使用

当前 JSON 位于仓库根目录，不会自动包含在 Vite 的前端构建产物中。需要通过浏览器请求时，可将文件放入 `frontend/public/data/`，然后读取：

```ts
const response = await fetch('/data/zhongguose-colors.json');

if (!response.ok) {
  throw new Error(`颜色数据加载失败：${response.status}`);
}

const colors = (await response.json()) as ChineseColor[];
```

如果需要在前端源码中静态导入，可将文件放入 `frontend/src/data/`，并根据项目的 TypeScript 配置启用 JSON 模块导入。

## Python

在仓库根目录运行：

```python
import json
from pathlib import Path

data_path = Path("data/zhongguose-colors.json")

with data_path.open(encoding="utf-8") as file:
    colors = json.load(file)

color = next(item for item in colors if item["name"] == "乳白")
print(color["hex"])  # #F9F4DC
print(tuple(color["rgb"]))  # (249, 244, 220)
```

建立名称和拼音索引，适合重复查询：

```python
colors_by_name = {item["name"]: item for item in colors}
colors_by_pinyin = {}

for item in colors:
    colors_by_pinyin.setdefault(item["pinyin"], []).append(item)

rubai = colors_by_name["乳白"]
same_pronunciation = colors_by_pinyin.get("rubai", [])
```

拼音索引的值应使用列表，以兼容同音颜色。

## 使用注意事项

- HEX 值可直接用于 CSS，例如 `color: #F9F4DC`。
- RGB 数组顺序固定为红、绿、蓝，不包含透明度通道。
- `pinyin` 适合搜索和 URL 标识，但不能作为唯一键。
- 如需不区分大小写比较 HEX，应先统一调用 `toUpperCase()` 或 `toLowerCase()`。
- 如果程序不从仓库根目录启动，应基于源码文件位置构造绝对路径，不要依赖当前工作目录。
- 数据来自第三方网站；上游内容变化时，本地文件不会自动同步。
