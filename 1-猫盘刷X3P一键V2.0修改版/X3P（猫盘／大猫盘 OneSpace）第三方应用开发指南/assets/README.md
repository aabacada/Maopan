# X3P 应用骨架模板说明

本目录提供 `app-template/` 应用骨架参考。用于快速搭建一个新应用的目录结构。

## 目录结构

```
app-template/
├── app/
│   ├── conf.js        # 元数据（改 pack/name/port 等字段）
│   ├── app.sh         # 控制脚本（改 PKGNAME）
│   └── app.png        # 图标（100×100 透明画布 + 70×70 图标居中，见 references/app-structure.md）
├── bin/
│   ├── start.sh       # 启动脚本（改 PKGNAME/PORT）
│   └── stop.sh        # 停止脚本（改 PKGNAME）
├── web/               # 前端（放入 index.html/style.css/app.js）
├── server.js          # 后端（Node v6 兼容，零依赖）
└── package.json       # 可选
```

## 使用步骤

1. 复制 `app-template/` 为你的项目目录
2. 改 `app/conf.js` 的 `pack`（目录名）、`name`、`port`
3. 改 `app/app.sh` 和 `bin/*.sh` 里的 `PKGNAME` 为你的包名
4. 替换 `app/app.png` 图标
5. 编写 `server.js` 后端（遵循 Node v6 兼容规范，见 references/node-v6-compat.md）
6. 编写 `web/` 前端
7. 用 `scripts/build_app.sh` 打包，`scripts/deploy_app.sh` 部署

## 关键规范提醒

- 后端只用 Node 内置模块，零 npm 依赖
- 兼容 Node v6.7.0（无 async/await、无对象展开、url.parse 字段 null 兜底）
- 控制脚本靠 `basename $0` 区分 on/off/stat/del
- stat.sh 输出 `on`/`off`（无换行）
- 停用阻断：`/sata/.storage/appblock/<pack>` 文件
