# X3P 设备环境与探测方法

## 设备基本信息（实测环境，设备 IP 已脱敏）

| 项目 | 值 |
|------|-----|
| 系统 | OneOS（厂商定制 Linux） |
| Web 服务器 | nginx 1.10.2 |
| 管理端口 | 80（应用中心 / 文件管理器） |
| 架构 | aarch64（ARMv8 64 位） |
| SSH | 22 端口默认开放 |
| 登录账号 | `root` / `Etech12`（X3P 固件公开的通用默认口令，非本机私有；详见下节） |
| Node.js | v6.7.0（`/usr/bin/node`，2018 年编译，12MB） |
| 后端服务 | Python 为主（OneSpaceD 等），报错形如 `sysapi instance has no attribute xxx` |

## 关于默认口令（重要）

`root` / `Etech12` 是 **X3P / OneSpace 固件内置的通用默认 SSH 口令**，不是某台设备的私有凭据：

- 所有刷了 X3P 固件的猫盘、大猫盘、小白家庭云 N1 都一样；GitHub 刷机项目、恩山论坛、CSDN 及各类公开教程中普遍记载，属于全网公开信息。
- 网页管理后台另有 `admin` / `123456`，同样是公开默认值；个别固件版本 SSH 默认口令也是 `123456`。
- 用户若改过口令，`Etech12` 即失效 → 用 `DEVICE_PASS` 覆盖。

⚠️ **安全提醒**：口令公开意味着设备 root 等同「没有密码」，任何能连到 22 端口的人（同局域网、端口映射、UPnP）都能直接拿到 root。

- 首次登录后立刻 `passwd` 修改，并改掉网页后台的 `admin/123456`。
- X3P 根分区默认只读，改口令前先 `mount -o remount,rw /`；部分固件重启会还原 `/etc/shadow`，改完务必重启验证是否持久化。
- 不要把 22 端口映射到公网，关闭路由器 UPnP；有条件的改用 SSH 密钥并禁用密码认证。

## 磁盘与目录结构

- `/sata` — 数据盘（第三方应用、用户数据所在）
- `/sata/app/<pack>/` — 第三方应用真实安装目录
- `/sata/public` — 「公共目录」物理根（文件管理器 c=10）
- `/sata/home/admin` — 「我的文件」物理根（文件管理器 c=0，admin 为用户名）
- `/sata/.storage/appblock/` — 应用停用标记目录
- `/home` → 软链接到 `/sata/home`

## 探测方法（无文档时的反推策略）

1. **探测应用中心 API**：`curl -s http://IP/oneapi/app?method=list` 返回应用列表，从已有第三方应用（如 verysync）的真实字段反推元数据规范。
2. **反推应用结构**：SSH 登录后 `ls -la /sata/app/<已有应用>/` 查看目录布局，`cat` 其 `conf.js` / `app.sh` / `bin/*.sh` 反推控制协议。
3. **探测文件管理器**：`/opt/www/file/` 下有 `index.other.html`、`fileui.js`、`fileobject.js`、`fileutil.js`，grep 关键参数（如 `urlc`、`get_files_path`、`cmd`）反推 URL 参数语义。
4. **探测 nginx 路由**：`grep -rn "location\|alias\|root" /etc/nginx/` 理解 URL 与物理目录的映射。

## SSH 非交互登录（关键技巧）

设备无 `sshpass`、交互输入密码会被卡住。用 `SSH_ASKPASS` 机制非交互登录：

```bash
# 设备 IP 属私有信息，从环境变量注入；口令默认用固件公开默认值 Etech12
: "${DEVICE_IP:?请先设置 DEVICE_IP（设备 IP）}"
DEVICE_PASS="${DEVICE_PASS:-Etech12}"   # 设备若改过 root 口令，请用环境变量覆盖
export DEVICE_IP DEVICE_PASS

export SSH_ASKPASS=/tmp/ap.sh
# askpass 脚本不落明文口令，运行时从环境变量读取
cat > "$SSH_ASKPASS" <<'ASKPASS'
#!/bin/sh
printf '%s\n' "$DEVICE_PASS"
ASKPASS
chmod 700 "$SSH_ASKPASS"
export SSH_ASKPASS_REQUIRE=force
SSHOPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no"

# 执行远程命令
ssh $SSHOPTS root@"$DEVICE_IP" 'ls -la /sata/app' < /dev/null

# 用完清理：rm -f /tmp/ap.sh
```

要点：
- `< /dev/null` 重定向 stdin，强制走 askpass 分支
- `SSH_ASKPASS_REQUIRE=force` 强制使用 askpass 脚本
- `PubkeyAuthentication=no` + `PreferredAuthentications=password` 强制密码认证
- scp 同理，用相同 `-o` 选项
- askpass 脚本从环境变量读口令，**不把明文写进 `/tmp`**；用完 `rm -f` 删除，生产环境优先改用 SSH 密钥登录
- `Etech12` 是公开的固件默认值，脚本里保留它不会泄露隐私；**真正需要保密的是设备 IP 和用户自行修改后的新口令**

## 常用探测命令清单

```bash
# 查看挂载与目录
mount | grep -i sata
ls -la /sata/ /sata/public/ /sata/home/admin/

# 查看应用列表
curl -s "http://IP/oneapi/app?method=list"

# 查看进程 / 端口
ps | grep -iE "node|onespace|samba" | grep -v grep
netstat -tlnp 2>/dev/null | grep -E "80|81|8899"

# 查看 nginx 配置
grep -rn "location\|alias\|root\|listen" /etc/nginx/ 2>/dev/null
```

## 注意事项

- 设备是精简嵌入式系统，很多常见命令/工具缺失（无 `sshpass`、部分 busybox 工具精简），探测时优先用系统自带能力。
- 文件管理器前端实际由 OneSpaceD（81 端口）的 `/oneapi/file` 接口服务，需要 session 认证，直接调用较复杂；后端如需浏览本地目录，直接用 Node 的 `fs` 读 `/sata` 目录最稳定，绕开 session。
- 系统 CA 证书库过期，Node https 请求外部服务需 `rejectUnauthorized: false`（见 network-services.md）。
