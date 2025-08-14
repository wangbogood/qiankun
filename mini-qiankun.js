/**
 * 简化版 Qiankun 微前端框架
 * 核心功能: 子应用注册、路由匹配、应用加载与挂载、简单沙箱隔离
 */

// 存储已注册的子应用
let apps = [];
// 当前激活的子应用
let activeApp = null;
// 沙箱实例
let sandbox = null;

/**
 * 注册子应用
 * @param {object} app - 子应用列表
 * 每个子应用包含: name, entry, container, activeRule
 */
function registerMicroApps(app) {
  apps.push(app)
}

/**
 * 启动微前端框架
 */
function start() {
  // 初始化沙箱
  sandbox = createSandbox();

  // 监听路由变化
  window.addEventListener('popstate', () => {
    reroute();
  });

  // 初始路由匹配
  reroute();
}

/**
 * 路由变化时重新匹配子应用
 */
function reroute() {
  const pathname = window.location.pathname;

  // 查找匹配的子应用
  const matchedApp = apps.find(app => {
    return pathname.startsWith(app.activeRule);
  });
  console.log('----matchedApp',apps,matchedApp)
  // 如果没有匹配的子应用或当前应用已激活，则不处理
  if (!matchedApp || (activeApp && activeApp.name === matchedApp.name)) {
    return;
  }

  // 卸载当前激活的子应用
  if (activeApp) {
    unmountApp(activeApp);
  }

  // 激活新的子应用
  activeApp = matchedApp;
  loadAndMountApp(matchedApp);
}

/**
 * 加载并挂载子应用
 * @param {Object} app - 子应用配置
 */
function loadAndMountApp(app) {
  const container = document.querySelector(app.container);
  if (!container) {
    console.error(`容器 ${app.container} 不存在`);
    return;
  }

  // 清空容器
  container.innerHTML = '';

  // 创建 iframe 作为子应用的运行环境
  const iframe = document.createElement('iframe');
  iframe.src = app.entry;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  // 当 iframe 加载完成后，通知子应用挂载
  iframe.onload = function() {
    // 在沙箱中执行子应用挂载
    sandbox.exec(`
      if (window.app && window.app.mount) {
        window.app.mount('${app.container}');
      }
    `);
  };

  container.appendChild(iframe);
}

/**
 * 卸载子应用
 * @param {Object} app - 子应用配置
 */
function unmountApp(app) {
  const container = document.querySelector(app.container);
  if (container) {
    // 在沙箱中执行子应用卸载
    sandbox.exec(`
      if (window.app && window.app.unmount) {
        window.app.unmount('${app.container}');
      }
    `);
    container.innerHTML = '';
  }
  activeApp = null;
}

/**
 * 创建简单沙箱
 * @returns {Object} 沙箱对象，包含 exec 方法
 */
function createSandbox() {
  // 简单沙箱实现，使用闭包隔离全局变量
  const sandboxGlobal = {};

  return {
    /**
     * 在沙箱中执行代码
     * @param {string} code - 要执行的代码字符串
     * @returns {any} 代码执行结果
     */
    exec(code) {
      // 使用 with 语句将 sandboxGlobal 作为作用域的顶层对象
      // 注意：实际生产环境中应使用更安全的沙箱实现
      try {
        const func = new Function('sandbox', `with(sandbox) { ${code} }`);
        return func(sandboxGlobal);
      } catch (error) {
        console.error('沙箱执行错误:', error);
        return null;
      }
    }
  };
}

/**
 * 手动导航到指定路径
 * @param {string} path - 目标路径
 */
function navigateTo(path) {
  alert(path)
  window.history.pushState(null, '', path);
  reroute();
}

// 暴露 API
window.registerMicroApps = registerMicroApps;
window.start = start;
window.navigateTo = navigateTo;