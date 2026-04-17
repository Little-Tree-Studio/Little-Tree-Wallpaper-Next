# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: 2026 Little Tree Studio <studio@zsxiaoshu.cn>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
                                                                                                    
                                                                                                    
                                                                                                    
                                                                                                    
                                                -++-                                                
                                               +%%%%#.                                              
                                              *%#%%%%#:                                             
                                             *%#%%%%%%#:                                            
                                           .*%#%%%%%%%%%:                                           
                                          .#%#%%%%%%%%%%%-                                          
                                         .#%#%%%%%%%%%%%%%-                                         
                                        :#%#%%%%%%%%%%%%%%%=                                        
                                       :#%#%%%%%%%%%%%%%%##*=                                       
                                      :##############%%%#****=                                      
                                     -##############%##*******=                                     
                                    -################**********+                                    
                                   =###############*************+                                   
                                  =##############****************+.                                 
                                 =#############*******************+.                                
                                +############*******************+===.                               
                               +###########*******************+==-===.                              
                              *##########*******************+=--===--=.                             
                            .*#########******************+==--==-------.                            
                           .*#######*******************+==-==-----------.                           
                          .*######******************+==-====-------------:                          
                         :*#*#*******************++==-===-----------------:                         
                        :**********************+=======--------------------:                        
                       :********************++========----------------------:                       
                      :*******************+===========-----------------------:                      
                     -*****************++=============------------------------:                     
                    :***************++===============---------------------------                    
                    .+***********++===================-------------------------:                    
                      .::::::::::::::::::::::.:------:........................                      
                                               ::::::.                                              
                                               ------:                                              
                                               ------.                                              
                                               ------.                                              
                                               ------:                                              
                                               ------:                                              
                                              .------:                                              
                                               :....:                                               

🌳 Little Tree Wallpaper Next Flet
Little Tree Studio
https://github.com/shu-shu-1/Little-Tree-Wallpaper-Next-Flet

================================================================================

Module Name: main.py

Copyright (C) 2026 Little Tree Studio <studio@zsxiaoshu.cn>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

Project Information:
    - Official Website: https://wp.zsxiaoshu.cn/
    - Repository: https://github.com/shu-shu-1/Little-Tree-Wallpaper-Next-Flet
    - Issue Tracker: https://github.com/shu-shu-1/Little-Tree-Wallpaper-Next-Flet/issues

Module Description:
    Thin entry point delegating to the modular application bootstrap.
"""
from __future__ import annotations

import sys
import traceback

import flet as ft

from app import Application
from app.ipc import IPCAlreadyRunningError
from app.paths import HITO_FONT_PATH, UI_FONT_PATH

_START_HIDDEN = any(arg.lower() in {"/hide", "--hide"} for arg in sys.argv[1:])


def main(page: ft.Page) -> None:
    """Delegate to the modular :class:`Application`."""
    try:
        app = Application(start_hidden=_START_HIDDEN)
    except IPCAlreadyRunningError:
        # 如果已有实例占用 IPC，显示提示界面，告知用户检查托盘图标，然后退出。
        page.clean()
        fonts: dict[str, str] = {}
        if UI_FONT_PATH.exists():
            fonts["UIDisplay"] = str(UI_FONT_PATH)
        if HITO_FONT_PATH.exists():
            fonts["Hitokoto"] = str(HITO_FONT_PATH)
        if fonts:
            page.fonts = fonts
            page.theme = ft.Theme(font_family="UIDisplay")

        page.horizontal_alignment = ft.CrossAxisAlignment.CENTER
        page.vertical_alignment = ft.MainAxisAlignment.CENTER
        page.padding = 24
        page.bgcolor = ft.Colors.SURFACE
        page.add(
            ft.Container(
            bgcolor=ft.Colors.SURFACE,
                padding=24,
                border_radius=16,
                content=ft.Column(
                    [
                        ft.Row(
                            [
                                ft.Icon(ft.Icons.NOTIFICATIONS_ACTIVE, color=ft.Colors.AMBER, size=28),
                                ft.Text("已检测到正在运行的实例", size=22, weight=ft.FontWeight.BOLD),
                            ],
                            spacing=12,
                            vertical_alignment=ft.CrossAxisAlignment.CENTER,
                        ),
                        ft.Text(
                            "本次启动已取消。请检查系统托盘中的小树壁纸图标，先退出现有实例后再重试。",
                            size=14,
                        ),
                        ft.Text(
                            "如未在托盘看到图标，可稍等片刻或在任务管理器结束旧进程再启动。",
                            size=12,
                            color=ft.Colors.GREY,
                        ),
                        ft.Row(
                            [
                                ft.ElevatedButton(
                                    "退出",
                                    icon=ft.Icons.CLOSE,
                                    on_click=lambda _e: getattr(page.window, "destroy", lambda: None)(),
                                ),
                            ],
                            alignment=ft.MainAxisAlignment.END,
                        ),
                    ],
                    spacing=14,
                    tight=True,
                ),
            ),
        )
        page.update()
        return

    app(page)


if __name__ == "__main__":
    try:
        ft.app(target=main)
    except Exception as e:
        # 获取完整的异常信息包括堆栈跟踪
        error_message = f"发生错误: {e!s}\n\n详细信息:\n{traceback.format_exc()}"
        try:
            with open("crush.log", "a", encoding="utf-8") as f:
                f.write(error_message + "\n")
        except Exception:
            pass


