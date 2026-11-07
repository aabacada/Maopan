#!/bin/sh
# X3P 第三方应用 —— 启动脚本（模板）

export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/bin/X11:/usr/local/bin

PKGNAME=yourapp          # TODO: 改成你的包名
INSTALLDIR=/sata/app
BLOCKDIR=/sata/.storage/appblock
PORT=8899                # TODO: 改成你的端口

# 用户停用状态则拒绝启动
if [ -f ${BLOCKDIR}/${PKGNAME} ] ; then
	echo "Start Abort, User Disabled"
	exit
fi

# 已在运行则跳过
if [ -f ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid ] ; then
	PID=`cat ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid 2>/dev/null`
	if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
		exit
	fi
fi

umask 0
cd ${INSTALLDIR}/${PKGNAME}

# 创建配置目录
mkdir -p ${INSTALLDIR}/${PKGNAME}/config

# 定位 node（多路径尝试）
NODE_BIN=""
for c in node /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
	if command -v $c >/dev/null 2>&1 ; then
		NODE_BIN=`command -v $c`
		break
	fi
	if [ -x "$c" ] ; then
		NODE_BIN="$c"
		break
	fi
done

if [ -z "$NODE_BIN" ] ; then
	echo "Node.js not found" >> ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.log 2>&1
	exit 1
fi

# 通过环境变量传配置给 Node 后端
export X3P_APP_DIR=${INSTALLDIR}/${PKGNAME}
export PORT=$PORT

nohup $NODE_BIN ${INSTALLDIR}/${PKGNAME}/server.js >> ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.log 2>&1 &
echo $! > ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid
