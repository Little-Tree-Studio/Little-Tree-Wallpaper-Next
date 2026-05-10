from __future__ import annotations

import ctypes
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

from loguru import logger


def _try_subprocess(cmd: list[str], **kwargs) -> str | None:
    try:
        return subprocess.check_output(cmd, text=True, **kwargs).strip()
    except FileNotFoundError:
        logger.debug("命令未找到: {}", cmd[0])
        return None
    except subprocess.CalledProcessError as e:
        logger.debug("命令失败 {}: returncode={}, stderr={}", cmd, e.returncode, e.stderr)
        return None
    except Exception as e:
        logger.debug("运行命令 {} 时出错: {}", cmd, e)
        return None


def _from_file_uri(raw: str) -> str:
    if raw.startswith("file://"):
        return unquote(urlparse(raw).path)
    return unquote(raw)


def _expanduser(path: str) -> str:
    if path.startswith("~"):
        return os.path.expanduser(path)
    return path


def get_sys_wallpaper(windows_way: str = "reg") -> str | None:
    """返回当前系统桌面壁纸的绝对路径；失败返回 None。
    支持 Windows / macOS / Linux(GNOME/KDE/XFCE/LXQt/Hyprland/Sway 等)。
    """
    if os.name == "nt":
        # ---------- Windows ----------
        if windows_way == "reg":
            try:
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop",
                ) as key:
                    path, _ = winreg.QueryValueEx(key, "WallPaper")
                return path if os.path.isfile(path) else None
            except Exception as e:
                logger.debug("Windows 注册表读取失败: {}", e)
                return None
        else:
            try:
                buffer = ctypes.create_unicode_buffer(512)
                result = ctypes.windll.user32.SystemParametersInfoW(
                    0x0073,
                    512,
                    buffer,
                    0,
                )
                if result:
                    path = buffer.value
                    return path if os.path.isfile(path) else None
                return None
            except Exception as e:
                logger.debug("Windows ctypes 读取失败: {}", e)
                return None

    if sys.platform == "darwin":
        # ---------- macOS ----------
        try:
            script = 'tell application "System Events" to get POSIX path of picture of every desktop'
            out = _try_subprocess(["osascript", "-e", script])
            if not out:
                return None
            candidates = [p.strip() for p in re.split(r",\s+|\n+", out) if p.strip()]
            for p in candidates:
                if os.path.isfile(p):
                    return p
            return None
        except Exception as e:
            logger.debug("macOS AppleScript 读取失败: {}", e)
            return None

    if sys.platform.startswith("linux"):
        # ---------- Linux ----------
        # 1) GNOME / Unity / Cinnamon / Budgie / MATE 等 gsettings 方案
        schemas = [
            ("org.gnome.desktop.background", "picture-uri-dark"),
            ("org.gnome.desktop.background", "picture-uri"),
            ("org.cinnamon.desktop.background", "picture-uri"),
            ("org.mate.background", "picture-filename"),
        ]
        for schema, key in schemas:
            try:
                uri_out = _try_subprocess(["gsettings", "get", schema, key])
                if not uri_out or uri_out in {"''", '""', "None"}:
                    continue
                uri_out = uri_out.strip()
                if (uri_out.startswith("'") and uri_out.endswith("'")) or (
                    uri_out.startswith('"') and uri_out.endswith('"')
                ):
                    uri_out = uri_out[1:-1]
                candidates = [s.strip() for s in uri_out.split(",")]
                for cand in candidates:
                    path = _from_file_uri(cand)
                    if os.path.isfile(path):
                        return path
            except Exception as e:
                logger.debug("gsettings {} {} 读取失败: {}", schema, key, e)

        # 2) KDE Plasma 5/6
        kde_readers = [
            ["kreadconfig6"],
            ["kreadconfig5"],
        ]
        for reader in kde_readers:
            try:
                out = _try_subprocess(
                    reader
                    + [
                        "--file", "plasma-org.kde.plasma.desktop-appletsrc",
                        "--group", "Containments",
                        "--group", "1",
                        "--group", "Wallpaper",
                        "--group", "org.kde.image",
                        "--group", "General",
                        "--key", "Image",
                    ]
                )
                if out:
                    path = _from_file_uri(out.strip())
                    if os.path.isfile(path):
                        return path
            except Exception as e:
                logger.debug("KDE {} 读取失败: {}", reader[0], e)

        kde_conf = os.path.expanduser(
            "~/.config/plasma-org.kde.plasma.desktop-appletsrc",
        )
        if os.path.isfile(kde_conf):
            try:
                images = []
                with open(kde_conf, encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("Image="):
                            val = line.split("=", 1)[1].strip()
                            p = _from_file_uri(val)
                            images.append(p)
                for p in reversed(images):
                    if os.path.isfile(p):
                        return p
            except Exception as e:
                logger.debug("KDE 配置文件解析失败: {}", e)

        # 3) XFCE
        try:
            props_out = _try_subprocess(
                ["xfconf-query", "--channel", "xfce4-desktop", "--property", "/backdrop", "--list"],
            )
            if props_out:
                props = [p.strip() for p in props_out.splitlines() if p.strip()]
                for prop in props:
                    if prop.endswith("image-path") or prop.endswith("last-image"):
                        val = _try_subprocess(
                            [
                                "xfconf-query",
                                "--channel",
                                "xfce4-desktop",
                                "--property",
                                prop,
                            ],
                        )
                        if val:
                            p = _from_file_uri(val.strip())
                            if os.path.isfile(p):
                                return p
        except Exception as e:
            logger.debug("XFCE 读取失败: {}", e)

        # 4) LXQt / PCManFM-Qt
        lxqt_profiles = ["lxqt", "lxqtwayland", "default"]
        for profile in lxqt_profiles:
            conf_path = os.path.expanduser(f"~/.config/pcmanfm-qt/{profile}/settings.conf")
            if not os.path.isfile(conf_path):
                continue
            try:
                with open(conf_path, encoding="utf-8", errors="ignore") as f:
                    current_section = None
                    for line in f:
                        line = line.strip()
                        if line.startswith("[") and line.endswith("]"):
                            current_section = line[1:-1]
                            continue
                        if current_section == "Desktop":
                            for key in ("wallpaper=", "desktop_bg=", "bg="):
                                if line.startswith(key):
                                    path = _expanduser(line.split("=", 1)[1].strip())
                                    if os.path.isfile(path):
                                        return path
            except Exception as e:
                logger.debug("LXQt profile={} 读取失败: {}", profile, e)

        # 5) LXDE (PCManFM GTK)
        lxde_conf = os.path.expanduser("~/.config/pcmanfm/LXDE/desktop-items-0.conf")
        if os.path.isfile(lxde_conf):
            try:
                with open(lxde_conf, encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("wallpaper="):
                            path = _expanduser(line.split("=", 1)[1].strip())
                            if os.path.isfile(path):
                                return path
            except Exception as e:
                logger.debug("LXDE 读取失败: {}", e)

        # 6) Deepin
        try:
            out = _try_subprocess(
                ["gsettings", "get", "com.deepin.wrap.gsettings", "picture-uri"]
            ) or _try_subprocess(
                ["gsettings", "get", "com.deepin.dde.appearance", "background"]
            )
            if out and out not in {"''", '""', "None"}:
                out = out.strip().strip("'\"")
                path = _from_file_uri(out)
                if os.path.isfile(path):
                    return path
        except Exception as e:
            logger.debug("Deepin 读取失败: {}", e)

        # 7) Hyprland (hyprpaper)
        try:
            out = _try_subprocess(["hyprctl", "hyprpaper", "listactive"])
            if out:
                for line in out.splitlines():
                    if "=" in line:
                        path = line.split("=", 1)[1].strip()
                        path = _expanduser(path)
                        if os.path.isfile(path):
                            return path
        except Exception as e:
            logger.debug("Hyprland hyprctl 读取失败: {}", e)

        hyprpaper_conf = os.path.expanduser("~/.config/hypr/hyprpaper.conf")
        if os.path.isfile(hyprpaper_conf):
            try:
                with open(hyprpaper_conf, encoding="utf-8", errors="ignore") as f:
                    in_block = False
                    current_path = None
                    for line in f:
                        stripped = line.strip()
                        if stripped.startswith("wallpaper {"):
                            in_block = True
                            current_path = None
                            continue
                        if in_block and stripped == "}":
                            if current_path:
                                path = _expanduser(current_path)
                                if os.path.isfile(path):
                                    return path
                            in_block = False
                            continue
                        if in_block and stripped.startswith("path"):
                            current_path = stripped.split("=", 1)[1].strip()
                            continue
                        if not in_block and stripped.startswith("wallpaper ="):
                            parts = stripped.split("=", 1)[1].strip().split(",")
                            if len(parts) >= 2:
                                path = _expanduser(parts[-1].strip())
                                if os.path.isfile(path):
                                    return path
            except Exception as e:
                logger.debug("Hyprpaper 配置解析失败: {}", e)

        # 8) Sway
        sway_conf = os.path.expanduser("~/.config/sway/config")
        if os.path.isfile(sway_conf):
            try:
                with open(sway_conf, encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("output") and "bg" in line:
                            parts = line.split()
                            if len(parts) >= 4 and "bg" in parts:
                                idx = parts.index("bg")
                                if idx + 1 < len(parts):
                                    path = _expanduser(parts[idx + 1])
                                    if os.path.isfile(path):
                                        return path
            except Exception as e:
                logger.debug("Sway 配置解析失败: {}", e)

        try:
            out = _try_subprocess(["ps", "-eo", "cmd"])
            if out:
                for proc_line in out.splitlines():
                    if "swaybg" in proc_line and "-i" in proc_line:
                        parts = proc_line.split()
                        for i, p in enumerate(parts):
                            if p == "-i" and i + 1 < len(parts):
                                path = _expanduser(parts[i + 1])
                                if os.path.isfile(path):
                                    return path
        except Exception as e:
            logger.debug("swaybg 进程读取失败: {}", e)

        # 9) 通用第三方工具 fallback
        # 9a) feh
        fehbg = os.path.expanduser("~/.fehbg")
        if os.path.isfile(fehbg):
            try:
                with open(fehbg, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    matches = re.findall(r"['\"](.+?)['\"]", content)
                    for m in matches:
                        path = _expanduser(m)
                        if os.path.isfile(path):
                            return path
            except Exception as e:
                logger.debug("fehbg 读取失败: {}", e)

        # 9b) nitrogen
        nitrogen_cfg = os.path.expanduser("~/.config/nitrogen/bg-saved.cfg")
        if os.path.isfile(nitrogen_cfg):
            try:
                with open(nitrogen_cfg, encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("file="):
                            path = _expanduser(line.split("=", 1)[1].strip())
                            if os.path.isfile(path):
                                return path
            except Exception as e:
                logger.debug("nitrogen 配置读取失败: {}", e)

        # 9c) wbg
        try:
            out = _try_subprocess(["ps", "-eo", "cmd"])
            if out:
                for proc_line in out.splitlines():
                    stripped = proc_line.strip()
                    if stripped.startswith("wbg "):
                        parts = stripped.split()
                        if len(parts) >= 2:
                            path = _expanduser(parts[1])
                            if os.path.isfile(path):
                                return path
        except Exception as e:
            logger.debug("wbg 进程读取失败: {}", e)
    return None


def _get_desktop_environments() -> set[str]:
    """获取当前桌面环境标识符集合，处理 XDG_CURRENT_DESKTOP 的冒号分隔值。
    同时通过特定环境变量检测 Hyprland / Sway。
    """
    de = os.environ.get("XDG_CURRENT_DESKTOP", "").lower()
    session = os.environ.get("DESKTOP_SESSION", "").lower()
    desktops = set()
    for val in (de, session):
        if val:
            desktops.update(val.split(":"))
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        desktops.add("hyprland")
    if os.environ.get("SWAYSOCK"):
        desktops.add("sway")
    return desktops


def _safe_applescript_string(s: str) -> str:
    """转义 AppleScript 字符串中的双引号，防止脚本注入/语法错误。"""
    return s.replace('"', '\\"')


def set_wallpaper(path: str) -> None:
    """将指定图片设置为当前桌面壁纸。
    支持 Windows / macOS / Linux 常见桌面环境。
    """
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(path):
        raise FileNotFoundError(path)

    system = platform.system()

    if system == "Windows":
        ctypes.windll.user32.SystemParametersInfoW(
            20,
            0,
            ctypes.c_wchar_p(path),
            3,
        )
        import winreg as reg

        key = reg.OpenKey(
            reg.HKEY_CURRENT_USER, r"Control Panel\Desktop", 0, reg.KEY_SET_VALUE,
        )
        reg.SetValueEx(key, "Wallpaper", 0, reg.REG_SZ, path)
        reg.CloseKey(key)
        logger.debug("Windows 壁纸已设置为: {}", path)
        return

    if system == "Darwin":
        safe_path = _safe_applescript_string(path)
        script = f'tell application "System Events" to tell every desktop to set picture to "{safe_path}"'
        subprocess.run(["osascript", "-e", script], check=True)
        logger.debug("macOS 壁纸已设置为: {}", path)
        return

    if system != "Linux":
        raise OSError("Unsupported operating system")

    desktops = _get_desktop_environments()
    logger.debug("检测到桌面环境: {}", desktops)

    if {"gnome", "unity", "budgie"} & desktops:
        uri = Path(path).as_uri()
        subprocess.run(
            ["gsettings", "set", "org.gnome.desktop.background", "picture-uri", uri],
            check=True,
        )
        subprocess.run(
            ["gsettings", "set", "org.gnome.desktop.background", "picture-uri-dark", uri],
            check=False,
        )
        logger.debug("GNOME/Unity/Budgie 壁纸已设置")
        return

    if "mate" in desktops:
        subprocess.run(
            ["gsettings", "set", "org.mate.background", "picture-filename", path],
            check=True,
        )
        logger.debug("MATE 壁纸已设置")
        return

    if "cinnamon" in desktops:
        uri = Path(path).as_uri()
        subprocess.run(
            ["gsettings", "set", "org.cinnamon.desktop.background", "picture-uri", uri],
            check=True,
        )
        logger.debug("Cinnamon 壁纸已设置")
        return

    if "xfce" in desktops:
        result = subprocess.run(
            ["xfconf-query", "-c", "xfce4-desktop", "-p", "/backdrop", "-l"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if "image-path" in line or "last-image" in line:
                    r = subprocess.run(
                        ["xfconf-query", "-c", "xfce4-desktop", "-p", line, "-s", path],
                        capture_output=True,
                    )
                    if r.returncode != 0:
                        logger.debug("XFCE 设置 {} 失败: {}", line, r.stderr.decode())
        else:
            logger.debug("XFCE 获取 backdrop 列表失败: {}", result.stderr)
        logger.debug("XFCE 壁纸已设置")
        return

    if "kde" in desktops or "plasma" in desktops:
        uri_path = Path(path).as_uri()
        script = f"""
        var allDesktops = desktops();
        for (i=0;i<allDesktops.length;i++) {{
            d = allDesktops[i];
            d.wallpaperPlugin = "org.kde.image";
            d.currentConfigGroup = Array("Wallpaper", "org.kde.image", "General");
            d.writeConfig("Image", "{uri_path}");
        }}
        """
        dbus_cmds = ["qdbus6", "qdbus"]
        for dbus_cmd in dbus_cmds:
            if shutil.which(dbus_cmd):
                subprocess.run(
                    [
                        dbus_cmd,
                        "org.kde.plasmashell",
                        "/PlasmaShell",
                        "org.kde.PlasmaShell.evaluateScript",
                        script,
                    ],
                    check=True,
                )
                logger.debug("KDE Plasma 壁纸已通过 {} 设置", dbus_cmd)
                return
        raise OSError("KDE Plasma 设置壁纸需要 qdbus6 或 qdbus，但均未找到")

    if "deepin" in desktops:
        uri = Path(path).as_uri()
        candidates = [
            ("com.deepin.wrap.gnome.desktop.background", "picture-uri"),
            ("com.deepin.wrap.gnome.desktop.background", "background"),
            ("com.deepin.dde.appearance", "picture-uri"),
            ("com.deepin.dde.appearance", "background"),
        ]
        for schema, key in candidates:
            r = subprocess.run(
                ["gsettings", "set", schema, key, uri if "uri" in key else path],
                capture_output=True,
            )
            if r.returncode == 0:
                logger.debug("Deepin 壁纸已通过 {}/{} 设置", schema, key)
                return
            logger.debug("Deepin {}/{} 尝试失败: {}", schema, key, r.stderr.decode().strip())
        logger.warning("Deepin 所有 gsettings 尝试均失败")
        return

    if "lxqt" in desktops:
        if shutil.which("pcmanfm-qt"):
            subprocess.run(["pcmanfm-qt", "--set-wallpaper", path], check=False)
            logger.debug("LXQt 壁纸已通过 pcmanfm-qt 设置")
            return
        if shutil.which("pcmanfm"):
            subprocess.run(["pcmanfm", "--set-wallpaper", path], check=False)
            logger.debug("LXQt 壁纸已通过 pcmanfm 设置")
            return

    if "lxde" in desktops:
        if shutil.which("pcmanfm"):
            subprocess.run(["pcmanfm", "--set-wallpaper", path], check=False)
            logger.debug("LXDE 壁纸已设置")
            return

    if "hyprland" in desktops:
        r = subprocess.run(
            ["hyprctl", "hyprpaper", "reload", f",{path}"],
            capture_output=True,
        )
        if r.returncode == 0:
            logger.debug("Hyprland 壁纸已通过 hyprpaper 设置")
            return
        logger.debug("Hyprland hyprpaper 设置失败: {}", r.stderr.decode().strip())

    if "sway" in desktops:
        if shutil.which("swaymsg"):
            r = subprocess.run(
                ["swaymsg", "output", "*", "bg", path, "fill"],
                capture_output=True,
            )
            if r.returncode == 0:
                logger.debug("Sway 壁纸已通过 swaymsg 设置")
                return
            logger.debug("Sway swaymsg 设置失败: {}", r.stderr.decode().strip())
        if shutil.which("swaybg"):
            subprocess.run(["pkill", "swaybg"], check=False)
            subprocess.Popen(["swaybg", "-i", path, "-m", "fill"])
            logger.debug("Sway 壁纸已通过 swaybg 设置")
            return

    gsettings_path = shutil.which("gsettings")
    if gsettings_path:
        uri = Path(path).as_uri()
        r = subprocess.run(
            [gsettings_path, "set", "org.gnome.desktop.background", "picture-uri", uri],
            capture_output=True,
        )
        subprocess.run(
            [gsettings_path, "set", "org.gnome.desktop.background", "picture-uri-dark", uri],
            capture_output=True,
        )
        if r.returncode == 0:
            logger.debug("通用 gsettings 壁纸已设置")
            return

    if shutil.which("feh"):
        subprocess.run(["feh", "--bg-scale", path], check=True)
        logger.debug("壁纸已通过 feh 设置")
        return
    if shutil.which("nitrogen"):
        subprocess.run(["nitrogen", "--set-scaled", path], check=True)
        logger.debug("壁纸已通过 nitrogen 设置")
        return
    if shutil.which("wbg"):
        subprocess.run(["pkill", "wbg"], check=False)
        subprocess.Popen(["wbg", path])
        logger.debug("壁纸已通过 wbg 设置")
        return

    raise OSError("无法识别当前 Linux 桌面环境或缺少设置工具")

