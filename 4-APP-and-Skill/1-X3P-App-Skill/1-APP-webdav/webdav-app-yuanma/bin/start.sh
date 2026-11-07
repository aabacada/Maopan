#!/bin/sh
# X3P WebDAV 应用 —— 启动脚本

export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/bin/X11:/usr/local/bin

PKGNAME=webdav
INSTALLDIR=/sata/app
BLOCKDIR=/sata/.storage/appblock
PORT=8899

# 用户停用状态则拒绝启动
if [ -f ${BLOCKDIR}/${PKGNAME} ] ; then
	echo "Start WebDAV Abort, User Disabled"
	exit
fi

# 已在运行则跳过
if [ -f ${INSTALLDIR}/${PKGNAME}/webdav.pid ] ; then
	PID=`cat ${INSTALLDIR}/${PKGNAME}/webdav.pid 2>/dev/null`
	if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
		exit
	fi
fi

umask 0

cd ${INSTALLDIR}/${PKGNAME}

# 创建配置与下载目录
mkdir -p ${INSTALLDIR}/${PKGNAME}/config ${INSTALLDIR}/${PKGNAME}/downloads

# 定位 node
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
	echo "WebDAV: Node.js not found" >> ${INSTALLDIR}/${PKGNAME}/webdav.log 2>&1
	exit 1
fi

# 启动服务
export X3P_APP_DIR=${INSTALLDIR}/${PKGNAME}
export X3P_DOWNLOAD_DIR=${INSTALLDIR}/${PKGNAME}/downloads
export PORT=$PORT

nohup $NODE_BIN ${INSTALLDIR}/${PKGNAME}/server.js >> ${INSTALLDIR}/${PKGNAME}/webdav.log 2>&1 &
echo $! > ${INSTALLDIR}/${PKGNAME}/webdav.pid
