<div align="center">
  <img src="./apps/app/icons/128x128.png" width="128" height="128" alt="ALLIGATORZONE" />
  <h1>ALLIGATORZONE</h1>
  <p><strong>ALLIGATORZONE 服务器专用启动器</strong></p>
</div>

---

## 这是什么

ALLIGATORZONE 私人服务器专用的 Minecraft 启动器。首次启动会自动创建实例、装好运行所需的模组，并连上服务器同步整合包。

- 服务器：`i.alligator.zone`
- 版本：Minecraft 1.21.1 · NeoForge 21.1.252

## 为什么有两个 mod 文件夹

| 文件夹 | 谁在管 | 能做什么 |
| --- | --- | --- |
| `mods/` | **服务端整合包**（AutoModpack 同步） | 只读。不要手动改动——任何启用、禁用、删除或回退都会导致进不去服务器 |
| `clientmods/` | **你自己** | 完全自由。从启动器里浏览安装、拖入 jar、启用禁用都可以 |

启动器里的「服务器 Mod」和「客户端 Mod」两个页面分别对应这两个文件夹。浏览页只允许安装到 `clientmods/`。

## 源码与许可

本项目是 [Axolotl Launcher](https://github.com/Mystic-Stars/Axolotl) 的修改版，依 **GPL-3.0-only** 发布，全文见 [COPYING.md](COPYING.md)。因为分发二进制，源码一并公开在这里。

第三方依赖各自使用其原有许可，详见 `packages/` 下各包内的许可声明。
