# 文件管理器路径映射与目录枚举

X3P 文件管理器前端在 `http://IP/file/index.html`，由 OneSpaceD（81 端口）的 `/oneapi/file` 接口（`cmd: "list"`）服务，需要 session 认证。

## URL 参数语义（核心）

文件管理器 URL 形如：`/file/index.html?c=<导航索引>&path=<相对路径>`

关键发现（从 `/opt/www/file/index.other.html` 第 165~176 行反推）：

```js
var ci = $.url("?c");       // c = 导航项索引
var path = $.url("?path");  // path = 相对路径，直接传给 list 接口
fileui.urlc = ci;
$("#filenav li:eq("+ci+")").addClass("selected");
fileobject.get_files_path(path);
```

### c 参数 = 导航项索引（filenav 的 li 顺序）

| 索引 c | 导航项 | path 属性 |
|--------|--------|-----------|
| 0 | 我的文件 | `path="/"` |
| 1 | 相册 | - |
| 2 | 音乐 | - |
| 3 | 电影 | - |
| 4 | 文档 | - |
| 5 | 标签 | - |
| 6 | 分享 | - |
| 7 | 冗余 | - |
| 8 | 压缩站 | `path="/.zips/"` |
| 9 | 回收站 | `path="/.recycle/"` |
| **10** | **公共目录** | **`path="public/"`** |
| 11 | 公共回收站 | `path="public/.recycle/"` |
| 12 | 从盘 | `path="public/HARDDISK/"` |
| 13 | USB盘 | `path="public/USBDISK/"` |

### 物理目录 ↔ 文件管理器参数映射

| 物理目录 | c | path 格式 |
|----------|---|-----------|
| `/sata/public`（公共目录根） | 10 | `public/` |
| `/sata/public/down` | 10 | `public/down/` |
| `/sata/home/admin`（我的文件根） | 0 | `/` |
| `/sata/home/admin/子目录` | 0 | `/子目录/` |

### 拼 URL 规则

- 公共目录下的文件/目录：`/file/index.html?c=10&path=public/<相对路径>/`
- 我的文件下的文件/目录：`/file/index.html?c=0&path=/<相对路径>/`

## 后端计算文件管理器路径（toFileManagerPath）

后端根据文件绝对路径判断落在哪个根，返回 `{ c, path }` 供前端拼 URL：

```js
const PUBLIC_ROOT = '/sata/public';      // c=10
const HOME_ROOT = '/sata/home/admin';    // c=0

function toFileManagerPath(absPath) {
  const target = path.resolve(absPath);
  // 公共目录
  const pub = path.resolve(PUBLIC_ROOT);
  if (target === pub) return { c: 10, path: 'public/' };
  if (target.indexOf(pub + path.sep) === 0) {
    const rel = target.slice(pub.length + 1).split(path.sep).join('/');
    return { c: 10, path: 'public/' + rel + '/' };
  }
  // 我的文件
  const home = path.resolve(HOME_ROOT);
  if (target === home) return { c: 0, path: '/' };
  if (target.indexOf(home + path.sep) === 0) {
    const rel = target.slice(home.length + 1).split(path.sep).join('/');
    return { c: 0, path: '/' + rel + '/' };
  }
  // 不在文件管理器可访问目录
  return null;
}
```

前端拼 URL：

```js
function openDir(fm) {
  if (!fm) { toast('该文件不在文件管理器可访问目录下'); return; }
  const url = `/file/index.html?c=${fm.c}&path=${encodeURIComponent(fm.path)}`;
  window.open(url, '_blank');
}
```

## 本地目录枚举（绕开 session 的方案）

文件管理器的 `/oneapi/file` 接口需要 session 认证，直接调用复杂。由于后端就运行在 NAS 上，**直接用 Node `fs` 读 `/sata` 目录最稳定**，绕开 session。

后端提供目录枚举接口：

```js
// GET /api/local/dirs?root=public|home&path=<相对路径>
function listLocalDirs(rootType, relPath) {
  const base = rootType === 'home' ? HOME_ROOT : PUBLIC_ROOT;
  let target = base;
  if (relPath) {
    target = path.resolve(base, relPath);
    // 防止路径穿越
    if (target !== base && target.indexOf(base + path.sep) !== 0) {
      return { error: '路径越界' };
    }
  }
  const dirs = fs.readdirSync(target)
    .filter(name => {
      if (name.charAt(0) === '.') return false;  // 隐藏目录
      try { return fs.statSync(path.join(target, name)).isDirectory(); }
      catch (e) { return false; }
    })
    .map(name => ({ name, path: relPath ? relPath + '/' + name : name }));
  return { dirs, path: relPath, root: base };
}
```

要点：
- **路径穿越防护**：`path.resolve` 后必须校验仍在 base 目录内
- **隐藏目录过滤**：`.开头` 的目录（如 `.recycle`、`.storage`）不展示
- **双根支持**：`root=public`（公共目录 `/sata/public`）和 `root=home`（我的文件 `/sata/home/admin`）用 tab 切换

## 前端目录选择器设计

1. 弹窗顶部提供「公共目录 / 我的文件」两个根 tab
2. 面包屑显示当前路径，可逐级返回
3. 点击目录名进入下一级，点击「选择此目录」确认
4. 选中的绝对路径回填到下载目录输入框
