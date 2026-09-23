# 🎙️ 分支访谈脚本编辑器

在可视化画布上创建问题节点，用「条件选项」把节点连接成有向流程图；系统实时检测
**环路、孤立节点、不可达节点、未覆盖出口、悬空连线**并在画布与侧栏中标记。
保存后可在「运行预览」中按回答逐题跳转、随时返回上一步，并把完整回答路径记录下来。
支持脚本 JSON 导入 / 导出，以及一键生成**只读分享链接**。

技术栈：**Python 3.12 + FastAPI + SQLite**，前端为**原生 HTML/CSS/JavaScript**（零构建、零 npm 依赖），
Docker Compose 单条命令启动。

---

## 🚀 单条命令启动

```bash
docker compose up -d --build
```

启动后浏览器打开：

> **http://localhost:8000**

停止：

```bash
docker compose down
```

数据（SQLite 数据库文件）持久化在宿主机 `./data/editor.db`，删除容器不会丢数据。

---

## 🔌 端口

| 用途 | 值 |
| --- | --- |
| 容器监听端口 | `8000` |
| 宿主机映射端口 | `8000`（在 `docker-compose.yml` 的 `ports` 中修改左侧端口即可，如 `"18000:8000"`） |

健康检查：`GET http://localhost:8000/api/health` → `{"status":"ok"}`

---

## ⚙️ 配置（环境变量）

在 `docker-compose.yml` 的 `environment:` 中配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_PATH` | `/data/editor.db` | SQLite 文件路径，对应挂载卷 `./data:/data` |
| `PUBLIC_BASE_URL` | （空，自动推导） | 只读分享链接的前缀。经域名/反向代理访问时建议设为对外地址，例如 `https://interview.example.com`；留空时自动使用当前请求的 Host |
| `PORT` | `8000` | 容器内监听端口，一般无需修改 |

修改配置后执行 `docker compose up -d` 重建容器即可生效。

---

## 🧭 使用指南

### 编辑画布

- **添加问题节点**：双击画布空白处，或点顶栏「＋ 问题节点」
- **编辑问题/选项文字**：直接在节点内输入
- **移动节点**：按住节点头部拖动
- **连接节点**：按住选项右侧的蓝色圆点，拖到目标节点上松开
- **标记结束分支**：勾选选项后的「结束」——该回答将终止访谈（勾选后连线自动断开）
- **断开连线**：选中连线（单击）后按 `Delete`，或双击连线确认断开
- **设为起点**：节点头部的 ⚑ 按钮；起点节点带蓝色边框与「起点」徽标
- **删除节点/选项**：节点头部 🗑 / 选项右侧 ✕（删除节点会自动断开相关连线）

### 实时校验（右侧面板）

保存与编辑过程中都会即时校验，并在画布上着色：

| 检查项 | 级别 | 画布表现 |
| --- | --- | --- |
| 环路（Tarjan SCC） | ❌ 错误 | 环节点红框，回边画红色虚线 |
| 孤立节点（无任何连线） | ❌ 错误 | 红色虚线框 + 粉底 |
| 悬空连线（目标节点不存在） | ❌ 错误 | 保存时拒绝（422），画布标红 |
| 从起点不可达 | ⚠️ 警告 | 节点半透明虚线框 |
| 未覆盖出口（选项既无目标也未标结束） | ⚠️ 警告 | 选项行黄色高亮 |
| 未设置/起点缺失 | ❌ 错误 | 侧栏提示 |

错误不阻止在编辑器中尝试运行（会二次确认），警告不影响保存。点击侧栏条目可定位到对应节点。

### 运行预览

点「▶ 运行预览」从起点开始，按回答按钮逐题跳转；面包屑实时显示已走路径，
「← 上一步」可回退，「结束并记录」可在中途终止。走到「结束」选项或终止后：

- 路径自动保存到后端（顶栏「📜 运行记录」可查看最近 100 次）
- 可一键复制本次路径 JSON

路径结构示例：

```json
[
  {"nodeId": "q1", "optionId": "o1", "answer": "是", "title": "用过产品吗？"},
  {"nodeId": "q2", "optionId": "o3", "answer": "4-5分", "title": "满意度", "terminal": true}
]
```

### 导入 / 导出 JSON

- **导出**：「⤓ 导出 JSON」下载带版本信封的文件
- **导入**：「⤒ 导入 JSON」选择文件，会创建为新脚本；同时兼容完整信封与裸文档两种格式

导出文件格式：

```json
{
  "version": 1,
  "kind": "branch-interview-script",
  "title": "访谈标题",
  "exportedAt": "2026-09-23T00:00:00Z",
  "document": {
    "root": "q1",
    "nodes": [
      {
        "id": "q1",
        "type": "question",
        "title": "问题文本",
        "x": 80, "y": 120,
        "options": [
          {"id": "o1", "label": "是", "terminal": false, "targetId": "q2"},
          {"id": "o2", "label": "否", "terminal": true,  "targetId": null}
        ]
      }
    ]
  }
}
```

### 只读分享链接

- 「🔗 只读分享」→「生成新链接」，得到形如 `http://localhost:8000/share/<token>` 的链接
- 持有者可以：查看画布与校验结果、运行预览（不上报记录）、导出 JSON
- 持有者**不能**做任何修改；可随时在分享弹窗中「撤销」链接使其立即失效

---

## 🗂 目录结构

```
.
├── app/
│   ├── main.py            # FastAPI 路由（脚本 CRUD、校验、分享、运行记录、导入导出）
│   ├── validation.py      # 图校验：环路/孤立/不可达/未覆盖出口（与前端同构）
│   ├── schemas.py         # Pydantic 模型与文档规范化
│   ├── database.py        # SQLite 连接与建表
│   ├── config.py          # 环境变量配置
│   └── static/            # 原生前端
│       ├── index.html     # 编辑器
│       ├── share.html     # 只读分享页
│       ├── style.css
│       └── js/            # api / validator / canvas / runner / editor / share
├── data/                  # SQLite 持久化目录（挂载卷）
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## 🧪 不用 Docker 的本地运行

```bash
pip install -r requirements.txt
DATABASE_PATH=./data/editor.db uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 📡 HTTP API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scripts` | 脚本列表（含错误/警告计数） |
| POST | `/api/scripts` | 新建脚本 |
| GET/PUT/PATCH/DELETE | `/api/scripts/{id}` | 读取 / 保存文档 / 改名 / 删除 |
| POST | `/api/scripts/{id}/validate` | 仅校验不落库 |
| GET | `/api/scripts/{id}/export` | 导出 JSON 信封 |
| POST | `/api/scripts/import` | 导入 JSON（信封或裸文档） |
| POST/GET | `/api/scripts/{id}/shares` | 生成 / 列出只读链接 |
| DELETE | `/api/shares/{token}` | 撤销链接 |
| GET | `/api/share/{token}` | 只读访问分享内容 |
| POST/GET | `/api/scripts/{id}/runs` | 保存 / 查看运行路径记录 |
| GET | `/api/health` | 健康检查 |
