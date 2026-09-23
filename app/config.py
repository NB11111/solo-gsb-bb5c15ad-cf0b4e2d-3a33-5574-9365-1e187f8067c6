"""全局配置。所有配置均可通过环境变量覆盖。"""
import os


def _default_db_path() -> str:
    # 容器内优先使用挂载卷 /data；直接在本机运行时回退到项目下 ./data
    candidate = "/data/editor.db"
    parent = "/data"
    if os.path.isdir(parent) and os.access(parent, os.W_OK):
        return candidate
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "editor.db")


# 数据库文件位置（容器内默认挂载到 /data 卷）
DATABASE_PATH = os.environ.get("DATABASE_PATH") or _default_db_path()

# 只读分享链接的基础地址；留空时使用请求中的 Host 自动拼接
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")

# 服务监听配置（仅 uvicorn 直接启动时使用）
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
