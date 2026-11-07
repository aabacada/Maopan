// X3P 应用前端逻辑骨架
// 通过 fetch 调用后端 API（浏览器环境不受 Node 版本限制）

function api(path, options) {
  return fetch(path, options).then(function (r) { return r.json(); });
}

// 页面初始化
api('/api/health').then(function (res) {
  console.log('后端健康检查：', res);
}).catch(function (err) {
  console.error('无法连接后端：', err);
});
