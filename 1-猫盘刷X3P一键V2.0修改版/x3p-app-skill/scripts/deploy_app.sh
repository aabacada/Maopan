#!/bin/sh
# =============================================================
#  X3P 第三方应用 —— SSH 一键部署脚本模板
#  用法（在开发机执行；设备 IP 属私有信息，从环境变量注入）：
#    DEVICE_IP=192.168.x.x sh deploy_app.sh
#    DEVICE_IP=192.168.x.x DEVICE_PASS='<已修改后的口令>' sh deploy_app.sh
#  作用：scp 上传 .app 到设备 → SSH 解压到 /sata/app/<pack>/ → 启动 → 验证
#
#  环境变量：
#    DEVICE_IP   设备 IP（必填，私有信息，不写入脚本）
#    DEVICE_PASS root 口令（可选，默认 Etech12 = X3P 固件全网公开的通用默认值）
#    APP_NAME    应用包名（默认 webdav）
#    PORT        服务端口（默认 8899）
# =============================================================

: "${DEVICE_IP:?请先设置环境变量 DEVICE_IP（设备 IP）}"
DEVICE_PASS="${DEVICE_PASS:-Etech12}"   # 公开的固件默认口令；改过口令的设备请用环境变量覆盖
export DEVICE_IP DEVICE_PASS
APP_NAME="${APP_NAME:-webdav}"   # 按需改成你的应用包名
PORT="${PORT:-8899}"             # 按需改成你的端口

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_FILE="$ROOT/dist/$APP_NAME.app"

# 非交互 SSH 登录：askpass 脚本不落明文口令，运行时从环境变量读取
export SSH_ASKPASS=/tmp/ap_deploy.sh
cat > "$SSH_ASKPASS" <<'ASKPASS'
#!/bin/sh
printf '%s\n' "$DEVICE_PASS"
ASKPASS
chmod 700 "$SSH_ASKPASS"
export SSH_ASKPASS_REQUIRE=force

OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no"

if [ ! -f "$APP_FILE" ]; then
  echo "[错误] 未找到 $APP_FILE，请先运行 build_app.sh"
  exit 1
fi

echo "== [1/4] 上传 $APP_NAME.app ..."
scp $OPTS "$APP_FILE" root@$DEVICE_IP:/tmp/ < /dev/null

echo "== [2/4] 解压到 /sata/app/$APP_NAME ..."
ssh $OPTS root@$DEVICE_IP "mkdir -p /sata/app/$APP_NAME && tar -xf /tmp/$APP_NAME.app -C /sata/app/" < /dev/null

echo "== [3/4] 配置权限并启动 ..."
ssh $OPTS root@$DEVICE_IP "chmod +x /sata/app/$APP_NAME/app/*.sh /sata/app/$APP_NAME/bin/*.sh && sh /sata/app/$APP_NAME/app/on.sh" < /dev/null

echo "== [4/4] 验证 ..."
sleep 2
STATUS=$(ssh $OPTS root@$DEVICE_IP "sh /sata/app/$APP_NAME/app/stat.sh" < /dev/null)
echo "  状态: $STATUS"

if [ "$STATUS" = "on" ]; then
  echo ""
  echo "=============================================="
  echo "  部署成功！访问 http://$DEVICE_IP:$PORT"
  echo "  日志: /sata/app/$APP_NAME/$APP_NAME.log"
  echo "=============================================="
else
  echo ""
  echo "  启动可能失败，查看日志："
  echo "  ssh root@$DEVICE_IP 'tail -30 /sata/app/$APP_NAME/$APP_NAME.log'"
  echo "=============================================="
fi

# 清理临时 askpass 脚本
rm -f "$SSH_ASKPASS"
