#!/bin/sh
# X3P WebDAV 应用 —— 停止脚本

export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/bin/X11:/usr/local/bin

PKGNAME=webdav
INSTALLDIR=/sata/app

# 通过 PID 文件停止
if [ -f ${INSTALLDIR}/${PKGNAME}/webdav.pid ] ; then
	PID=`cat ${INSTALLDIR}/${PKGNAME}/webdav.pid 2>/dev/null`
	if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
		kill $PID 2>/dev/null
		# 等待进程退出
		n=0
		while [ $n -lt 10 ] ; do
			kill -0 $PID 2>/dev/null || break
			sleep 1
			n=$((n+1))
		done
	fi
	rm -f ${INSTALLDIR}/${PKGNAME}/webdav.pid
fi

# 兜底：清理可能残留的 node server.js 进程
pkill -f "${INSTALLDIR}/${PKGNAME}/server.js" 2>/dev/null
