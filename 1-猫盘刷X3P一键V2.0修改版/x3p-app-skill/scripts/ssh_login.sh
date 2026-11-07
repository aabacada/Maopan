#!/bin/sh
# =============================================================
#  X3P 设备非交互 SSH 登录辅助脚本
#  用于在没有 sshpass 的开发机上执行远程命令 / scp 传文件。
#
#  设备 IP 从环境变量注入（私有信息，不写入脚本）；
#  root 口令默认用 X3P 固件公开的通用默认值 Etech12：
#    DEVICE_IP=192.168.x.x . ./ssh_login.sh
#    DEVICE_IP=192.168.x.x DEVICE_PASS='<已修改后的口令>' . ./ssh_login.sh
#
#  用法：
#    . ./ssh_login.sh                      # source 加载（会设置好环境变量）
#    ssh $SSHOPTS root@IP '命令' < /dev/null
#    scp $SSHOPTS 本地文件 root@IP:/路径 < /dev/null
#
#  或直接：
#    sh ssh_login.sh '要执行的远程命令'
# =============================================================

: "${DEVICE_IP:?请先设置环境变量 DEVICE_IP（设备 IP）}"
DEVICE_PASS="${DEVICE_PASS:-Etech12}"   # 公开的固件默认口令；改过口令的设备请用环境变量覆盖
export DEVICE_IP DEVICE_PASS

# askpass 脚本不落明文口令，运行时从环境变量读取
export SSH_ASKPASS=/tmp/ap.sh
cat > "$SSH_ASKPASS" <<'ASKPASS'
#!/bin/sh
printf '%s\n' "$DEVICE_PASS"
ASKPASS
chmod 700 "$SSH_ASKPASS"
export SSH_ASKPASS_REQUIRE=force

SSHOPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no"
export SSHOPTS

if [ $# -gt 0 ]; then
  # 传入了远程命令，直接执行
  ssh $SSHOPTS root@"$DEVICE_IP" "$1" < /dev/null
else
  echo "[ssh_login] 已配置非交互 SSH 登录："
  echo "  user=root  设备 IP 已配置（不回显）"
  echo "  用法：ssh \$SSHOPTS root@$DEVICE_IP '命令' < /dev/null"
  echo "        scp \$SSHOPTS 文件 root@$DEVICE_IP:/路径 < /dev/null"
fi
