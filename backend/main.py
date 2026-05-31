import os
import sys
import webview
from pathlib import Path
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from backend.api import BackendAPI
from backend.paths import get_cache_dir, ensure_dirs, BASE_DIR

ensure_dirs()

logger.add(get_cache_dir() / "logs" / "app_{time}.log", rotation="00:00", retention=10,
           level="DEBUG", encoding="utf-8")

def main() -> None:
    frontend_dir = BASE_DIR / "frontend" / "dist"
    index_html = frontend_dir / "index.html"
    
    # If dist doesn't exist, warn and try dev mode or create minimal
    if not index_html.exists():
        logger.warning(f"Frontend build not found at {index_html}. Please run 'npm run build' in frontend/")
        # Create a minimal fallback
        frontend_dir.mkdir(parents=True, exist_ok=True)
        index_html.write_text(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>小树壁纸 Next</title></head>'
            '<body><div id="root"><h1>前端未构建</h1><p>请在 frontend 目录运行 npm install && npm run build</p></div></body></html>',
            encoding="utf-8"
        )

    api = BackendAPI()
    window = webview.create_window(
        title="小树壁纸 Next",
        url=str(index_html),
        js_api=api,
        width=1200,
        height=800,
        min_size=(800, 600),
        text_select=True,
    )
    webview.start(debug=True)

if __name__ == "__main__":
    main()
