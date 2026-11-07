#!/bin/sh
# X3P 第三方应用 —— 停止脚本（模板）

export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/bin/X11:/usr/local/bin

PKGNAME=yourapp          # TODO: 改成你的包名
INSTALLDIR=/sata/app

# 通过 PID 文件停止（精确，避免误杀）
if [ -f ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid ] ; then
	PID=`cat ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid 2>/dev/null`
	if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
		kill $PID 2>/dev/null
		n=0
		while [ $n -lt 10 ] ; do
			kill -0 $PID 2>/dev/null || break
			sleep 1
			n=$((n+1))
		done
	fi
	rm -f ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid
fi

# 兜底：清理残留进程（模式需含完整路径，避免误杀 SSH 会话）
pkill -f "${INSTALLDIR}/${PKGNAME}/server.js" 2>/dev/null
