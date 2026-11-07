#!/bin/sh
# X3P 第三方应用 —— 主控制脚本（模板）
# 通过 on.sh/off.sh/stat.sh/del.sh 副本调用，靠 basename $0 区分动作

export PATH=/bin:/sbin:/usr/bin:/usr/sbin

ACTION=`basename $0`

PKGNAME=yourapp          # TODO: 改成你的包名
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

	# 通过 PID 文件判断运行状态
	if [ -f ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid ] ; then
		PID=`cat ${INSTALLDIR}/${PKGNAME}/${PKGNAME}.pid 2>/dev/null`
		if [ -n "$PID" ] && kill -0 $PID 2>/dev/null ; then
			echo -n "on"
		else
			echo -n "off"
		fi
	else
		echo -n "off"
	fi

fi
