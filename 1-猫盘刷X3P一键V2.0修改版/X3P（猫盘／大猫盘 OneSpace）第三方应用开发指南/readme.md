---
name: x3p-app-dev
description: 为猫盘/大猫盘 NAS（OneSpace X3P / OneOS 系统）开发、打包、部署第三方应用的完整指南。涵盖环境探测、SSH 部署、应用目录与元数据规范、Node.js v6 兼容开发、WebDAV 等网络服务接入、文件管理器目录映射、常见坑与调试方法。当用户需要为 X3P/猫盘/大猫盘设备开发或部署可安装的第三方应用（如网盘客户端、下载器、文件工具等）时使用此技能。触发词：X3P、猫盘、大猫盘、OneSpace、OneOS、OneSpaceD、/sata/app、/oneapi/app、第三方应用、NAS 应用。
agent_created: true
---

# X3P（猫盘/大猫盘 OneSpace）第三方应用开发指南

本技能沉淀了在大猫盘 NAS（OneSpace X3P / OneOS 系统）上从零开发并部署一个可安装的 WebDAV 客户端应用的完整经验，用于指导后续在该平台开发其它第三方应用。

> 本技能不含任何私有环境信息：设备 IP 一律用占位符或环境变量注入。文中出现的 `root` / `Etech12` 是 X3P 固件的**全网公开默认口令**（见「凭据与安全」），不是某台设备的私有凭据。

## 何时使用

- 用户要为 X3P / 猫盘 / 大猫盘 / OneSpace 设备开发、打包、部署应用
- 需要接入设备的文件系统、文件管理器、应用中心 API
- 需要让应用被「应用中心」识别（启停 / 卸载 / 状态）
- 需要处理设备预装的旧版 Node.js（v6.7.0）运行时

## 核心结论速览（务必先读）

1. **第三方应用真实目录是 `/sata/app/<pack>/`**，不是 `/app/thirdparty/`（后者只是 nginx 的 URL alias 映射）。
2. **应用元数据是 `app/conf.js`**（JSON 格式，字段见下），不是 `app.json`。
3. **第三方应用只能通过 SSH 部署**，没有网页上传通道（`/oneapi/file/upgrade` 是系统固件升级通道，`install` 方法有内部白名单，都不可用于自定义应用）。
4. **设备预装 Node.js v6.7.0**（`/usr/bin/node`，aarch64），后端代码必须兼容 v6（无 async/await、无对象展开、无可选链、无 `mkdirSync recursive`、`url.parse` 返回 null 字段）。
5. **SSH 默认开放**（22 端口），账号 `root`，固件默认口令 `Etech12`（全网公开，见「凭据与安全」）；设备 IP 用 `DEVICE_IP` 注入，口令可用 `DEVICE_PASS` 覆盖。
6. **文件管理器**（`http://IP/file/index.html`）通过 `c` 参数（导航项索引）和 `path` 参数（相对路径）定位目录，物理根目录分别是 `/sata/public`（公共目录）和 `/sata/home/admin`（我的文件）。

## 开发与部署工作流

按以下顺序执行：

1. **探测设备环境** → 读 `references/environment.md`
2. **按规范搭建应用结构** → 读 `references/app-structure.md`
3. **编写后端（Node v6 兼容）** → 读 `references/node-v6-compat.md`
4. **编写前端**（原生 HTML/CSS/JS，由后端静态托管）
5. **打包 `.app`** → 用 `scripts/build_app.sh`
6. **SSH 部署** → 读 `references/deployment.md`
7. **验证**（应用中心识别、启停、功能实测）

## 关键规范

### 应用目录结构（标准）

```
/sata/app/<pack>/
├── app/
│   ├── conf.js        # 元数据（JSON）
│   ├── app.sh         # 控制脚本（靠 basename $0 区分动作）
│   ├── on.sh off.sh stat.sh del.sh   # app.sh 的副本（Windows 下无法软链）
│   └── app.png        # 图标（100×100 透明画布 + 70×70 图标居中）
├── bin/
│   ├── start.sh       # 启动脚本
│   └── stop.sh        # 停止脚本
├── web/               # 前端（index.html / style.css / app.js）
├── server.js          # 后端（Node.js）
└── package.json       # 可选
```

### conf.js 元数据字段

```json
{
    "pack": "webdav",
    "ver": "2.1.0",
    "verno": 210,
    "name": "Webdav云盘",
    "logo": "app.png",
    "web": false,
    "url": "/",
    "port": 8899,
    "canstat": true,
    "canoff": true,
    "candel": true
}
```

- `pack`：包名（目录名，唯一标识）
- `ver` / `verno`：版本号字符串 / 整数（升级判断）
- `name`：应用中心显示名
- `logo`：图标文件名（在 `app/` 目录下）
- `port`：服务端口
- `canstat` / `canoff` / `candel`：是否支持状态查询 / 停止 / 卸载
- `web`：是否为 web 应用；`url`：web 入口路径

### 应用控制协议（app.sh）

`app.sh` 通过 `basename $0` 判断动作，`on.sh/off.sh/stat.sh/del.sh` 都是它的副本：

- `on.sh` → 删除 block 文件后调用 `bin/start.sh`
- `off.sh` → 调用 `bin/stop.sh`，无参数时创建 block 文件（用户停用标记）
- `stat.sh` → 输出 `on` 或 `off`（无换行，靠 PID 文件 + `kill -0` 判断）
- `del.sh` → 停用 + 删除整个应用目录 + 删除 block 文件

**停用阻断机制**：`/sata/.storage/appblock/<pack>` 文件存在 = 用户已停用；`start.sh` 启动前检查此文件，存在则拒绝启动。

## 详细参考

- `references/environment.md` — 设备环境、探测方法、SSH 登录方式
- `references/app-structure.md` — 应用目录、元数据、控制脚本、应用中心 API 完整规范
- `references/node-v6-compat.md` — Node v6 兼容开发要点与常见坑
- `references/deployment.md` — 打包、SSH 部署、验证流程
- `references/file-manager.md` — 文件管理器路径映射（`c` / `path` 参数）与目录枚举
- `references/network-services.md` — 接入外部 WebDAV 等网络服务的经验（HTTPS、证书、认证）

## 打包与部署脚本

- `scripts/build_app.sh` — 打包 `.app`（tar 归档）的通用脚本模板
- `scripts/deploy_app.sh` — SSH 一键部署脚本模板
- `scripts/ssh_login.sh` — 非交互 SSH 登录辅助（SSH_ASKPASS 方式）

使用前按实际应用名、端口修改脚本中的变量。

## 凭据与安全（务必先读）

### X3P 固件默认口令（公开信息，非私有凭据）

| 项 | 值 |
|---|---|
| SSH 账号 | `root` |
| SSH 默认口令 | `Etech12` |
| 网页管理后台 | `admin` / `123456` |

- `Etech12` 是 **X3P / OneSpace 固件内置的通用默认口令**：所有刷了该固件的猫盘、大猫盘、小白家庭云 N1 都一样，GitHub 刷机项目、恩山论坛、CSDN 等公开教程普遍记载，属于全网公开信息，不是任何一台设备的私有秘密。
- 个别固件版本 SSH 默认口令为 `123456`；用户若改过口令，`Etech12` 即失效 → 用 `DEVICE_PASS` 覆盖。
- ⚠️ **正因为口令公开，设备 root 等同「没有密码」**：任何能连到 22 端口的人（同局域网、端口映射、UPnP）都能直接登录。首次 SSH 登录后应立即 `passwd` 修改，网页后台 `admin/123456` 同样要改；X3P 根分区默认只读，改前先 `mount -o remount,rw /`，并重启验证是否持久化；不要把 22 端口映射到公网，有条件的改用 SSH 密钥并禁用密码认证。

### 环境信息注入（脱敏）

- **设备 IP 属于私有信息**：必须通过 `DEVICE_IP` 注入，脚本不设默认值，缺失直接报错退出。
- `DEVICE_PASS` 可选，默认回退到公开的 `Etech12`，可覆盖：`DEVICE_IP=192.168.x.x DEVICE_PASS='<已修改后的口令>' sh scripts/deploy_app.sh`
- `SSH_ASKPASS` 辅助脚本运行时从环境变量读取口令，**不把明文写进 `/tmp`**；用完 `rm -f` 清理。
- 打包 / 分享本技能前重新扫描，确认无真实设备 IP、账号、邮箱、本机用户名与绝对路径残留（公开固件默认口令 `Etech12` 允许保留）。
