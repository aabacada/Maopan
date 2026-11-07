#!/bin/sh
# X3P WebDAV 应用 —— 主控制脚本
# 通过软链接 on.sh/off.sh/stat.sh/del.sh 调用，用 basename $0 区分动作
# 与 X3P 系统（OneOS）第三方应用标准结构保持一致

export PATH=/bin:/sbin:/usr/bin:/usr/sbin

ACTION=`basename $0`

PKGNAME=webdav
BINNAME=node
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

	# 检测 WebDAV 服务是否在运行（通过 PID 文件判断，更准确）
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
