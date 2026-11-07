# X3P 应用目录结构与元数据规范

## 真实应用目录（从 verysync 反推）

```
/sata/app/<pack>/
├── app/
│   ├── conf.js        # 元数据（JSON）
│   ├── app.sh         # 主控制脚本（靠 basename $0 区分动作）
│   ├── on.sh off.sh stat.sh del.sh   # app.sh 的副本
│   └── app.png        # 图标
├── bin/
│   ├── start.sh       # 启动脚本
│   └── stop.sh        # 停止脚本
├── web/               # 前端静态文件（web 应用时）
├── server.js          # 后端入口
└── package.json       # 可选
```

> ⚠️ 注意：不是 `/app/thirdparty/<pack>/`。nginx 的 `/app/thirdparty/` URL 是通过 alias 映射到 `/sata/app/` 的。

## conf.js 元数据（完整字段）

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

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pack` | string | 包名，等于目录名，应用唯一标识 |
| `ver` | string | 版本号字符串 |
| `verno` | int | 版本号整数，用于升级判断 |
| `name` | string | 应用中心显示名称 |
| `logo` | string | 图标文件名（相对 `app/` 目录） |
| `web` | bool | 是否 web 应用 |
| `url` | string | web 入口路径 |
| `port` | int | 服务监听端口 |
| `canstat` | bool | 是否支持状态查询 |
| `canoff` | bool | 是否支持停止 |
| `candel` | bool | 是否支持卸载 |

## 应用中心 API（/oneapi/app）

方法（method 参数）：

- `list` — 列出所有应用（含元数据字段，可从返回反推规范）
- `install` — 安装（**有内部白名单，第三方自定义应用会被拒绝，报 `Invalid app name`**）
- `delete` — 删除
- `on` / `off` — 启停
- `stat` — 查询状态

> ⚠️ 关键结论：`install` 方法有系统内部白名单（连系统已有的 verysync 都返回 `Invalid app name`），第三方自定义应用**无法通过 API 安装**，只能 SSH 部署到 `/sata/app/<pack>/` 后，应用中心的 list 会自动识别（因为它是扫描 `/sata/app/` 目录的）。

## 应用中心图标加载逻辑

应用中心前端（`/opt/www/app/index.html`）加载图标的逻辑：

```js
var logopath = item.pack + '/' + item.logo;                              // 默认
if (item.candel) {
    logopath = 'thirdparty/' + item.pack + '/app/' + item.logo;          // 可卸载的应用走此分支
}
```

- `thirdparty` 是 `/sata/app` 的软链接
- 因此图标 URL 为 `http://IP/app/thirdparty/<pack>/app/app.png` = `/sata/app/<pack>/app/app.png`
- `candel: true` 时走 `thirdparty/` 分支

图标规范（实测最终方案）：
- **画布 100×100 PNG，透明背景**（`.item-logo{height:100px;width:100px}`，`img` 标签会被强制拉伸到 100×100）
- **图标主体 70×70，居中显示**（居中偏移 `(100-70)/2 = 15px`）
- 透明背景圆角方形（iOS 风格）在白色背景上最协调

图标制作方法（Pillow）：

```python
from PIL import Image, ImageDraw

# 原始图标（完整设计：蓝色渐变圆角方形 + 图形 + 文字）
src = Image.open('webdav.png').convert('RGBA')   # 例如 83×83
w, h = src.size

# 圆角矩形蒙版：把原图圆角外的留白转透明（圆角半径按实际，本例 12px）
radius = 12
mask = Image.new('L', (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, w-1, h-1], radius=radius, fill=255)
src.putalpha(mask)

# 缩放到目标尺寸（70×70），再居中放到 100×100 透明画布
icon = src.resize((70, 70), Image.LANCZOS)
canvas = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
canvas.paste(icon, ((100-70)//2, (100-70)//2), icon)
canvas.save('app.png')
```

> 说明：若原图四角是白色留白（而非透明），需先加圆角蒙版把圆角外转透明，否则缩放后白边会残留。图标主体尺寸可按需调整（曾用过 60/70/80），但始终 100×100 画布居中。

## 控制脚本协议（app.sh）

`app.sh` 的核心机制：**靠 `basename $0` 判断动作**，因此 `on.sh/off.sh/stat.sh/del.sh` 是同一个文件的副本（Windows 开发环境无法创建软链接，用 `cp` 复制即可）。

```sh
ACTION=`basename $0`
PKGNAME=webdav
INSTALLDIR=/sata/app
BLOCKDIR=/sata/.storage/appblock

if [ $ACTION = "del.sh" ] ; then
    ${INSTALLDIR}/${PKGNAME}/bin/stop.sh
    rm -rf ${INSTALLDIR}/${PKGNAME}
    rm -f  ${BLOCKDIR}/${PKGNAME}
elif [ $ACTION = "on.sh" ] ; then
    rm -f ${BLOCKDIR}/${PKGNAME}
    ${INSTALLDIR}/${PKGNAME}/bin/start.sh
elif [ $ACTION = "off.sh" ] ; then
    ${INSTALLDIR}/${PKGNAME}/bin/stop.sh
    if [ $# -eq 0 ] ; then
        touch ${BLOCKDIR}/${PKGNAME}
    fi
elif [ $ACTION = "stat.sh" ] ; then
    if [ -f ${INSTALLDIR}/${PKGNAME}/webdav.pid ] ; then
        PID=`cat ${INSTALLDIR}/${PKGNAME}/webdav.pid 2>/dev/null`
        if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
            echo -n "on"
        else
            echo -n "off"
        fi
    else
        echo -n "off"
    fi
fi
```

关键要点：

1. **stat.sh 必须 `echo -n "on"` / `echo -n "off"`**（无换行，应用中心据此判断状态）
2. **状态判断靠 PID 文件 + `kill -0`**，比 `pgrep` 更准确（避免匹配到 SSH 会话等误判）
3. **停用阻断**：`off.sh` 无参数时 `touch /sata/.storage/appblock/<pack>`，`start.sh` 启动前检查此文件，存在则 `exit`（拒绝启动）
4. **`on.sh` 先 `rm -f` block 文件**再启动

## start.sh 启动脚本要点

```sh
#!/bin/sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/bin/X11:/usr/local/bin
PKGNAME=webdav
INSTALLDIR=/sata/app
BLOCKDIR=/sata/.storage/appblock

# 用户停用状态则拒绝启动
if [ -f ${BLOCKDIR}/${PKGNAME} ] ; then
    echo "Start Abort, User Disabled"
    exit
fi

# 已在运行则跳过（PID 文件 + kill -0）
if [ -f ${INSTALLDIR}/${PKGNAME}/webdav.pid ] ; then
    PID=`cat ${INSTALLDIR}/${PKGNAME}/webdav.pid 2>/dev/null`
    if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then exit; fi
fi

umask 0
cd ${INSTALLDIR}/${PKGNAME}
mkdir -p ${INSTALLDIR}/${PKGNAME}/config ${INSTALLDIR}/${PKGNAME}/downloads

# 定位 node（多路径尝试）
NODE_BIN=""
for c in node /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
    if command -v $c >/dev/null 2>&1 ; then NODE_BIN=`command -v $c`; break; fi
    if [ -x "$c" ] ; then NODE_BIN="$c"; break; fi
done

export X3P_APP_DIR=${INSTALLDIR}/${PKGNAME}
export PORT=8899
nohup $NODE_BIN ${INSTALLDIR}/${PKGNAME}/server.js >> ${INSTALLDIR}/${PKGNAME}/webdav.log 2>&1 &
echo $! > ${INSTALLDIR}/${PKGNAME}/webdav.pid
```

要点：
- `nohup ... &` 后台启动，`echo $! > xxx.pid` 写 PID 文件
- 日志重定向到应用目录下 `.log` 文件（便于排障）
- 通过环境变量 `X3P_APP_DIR` / `PORT` 传配置给 Node 后端

## stop.sh 停止脚本要点

```sh
#!/bin/sh
PKGNAME=webdav
INSTALLDIR=/sata/app
if [ -f ${INSTALLDIR}/${PKGNAME}/webdav.pid ] ; then
    PID=`cat ${INSTALLDIR}/${PKGNAME}/webdav.pid 2>/dev/null`
    if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
        kill $PID
        n=0
        while [ $n -lt 10 ] ; do
            kill -0 $PID 2>/dev/null || break
            sleep 1
            n=$((n+1))
        done
    fi
    rm -f ${INSTALLDIR}/${PKGNAME}/webdav.pid
fi
# 兜底清理
pkill -f "${INSTALLDIR}/${PKGNAME}/server.js" 2>/dev/null
```

> ⚠️ 坑：早期用 `pkill -f "server.js"` 误杀了 SSH 会话（因为 SSH 命令行本身包含 `server.js` 字符串）。正确做法是：**先用 PID 文件精确 kill**，`pkill` 只作为兜底，且模式要包含完整路径 `${INSTALLDIR}/${PKGNAME}/server.js`。
