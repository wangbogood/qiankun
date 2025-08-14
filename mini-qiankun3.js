/**
 * 简化版 Qiankun 微前端框架 (非 iframe 实现)
 * 核心功能: 子应用注册、路由匹配、应用加载与挂载、JS沙箱、样式隔离
 */

// 存储已注册的子应用
let apps = [];
// 当前激活的子应用
let activeApp = null;
// 沙箱实例
let sandbox = null;
// 全局状态
const globalState = {};

/**
 * 注册子应用
 * @param {Object} app - 子应用配置
 * 包含: name, entry, container, activeRule
 */
function registerMicroApps(app) {
  apps.push(app);
  console.log('子应用已注册:', app.name);
}

/**
 * 启动微前端框架
 */
function start() {
  // 初始化沙箱
  sandbox = createSandbox();

  // 重写路由方法
  patchRouter();

  // 初始路由匹配
  reroute();
}

/**
 * 重写路由方法以拦截路由变化
 */
function patchRouter() {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function(...args) {
    originalPushState.apply(this, args);
    reroute();
  };

  window.history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    reroute();
  };

  // 监听popstate事件
  window.addEventListener('popstate', () => {
    reroute();
  });
}

/**
 * 路由变化时重新匹配子应用
 */
function reroute() {
  const pathname = window.location.pathname;
  console.log('当前路由:', pathname);

  // 查找匹配的子应用
  const matchedApp = apps.find(app => {
    return pathname.startsWith(app.activeRule);
  });
  console.log('匹配的子应用:', matchedApp);

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
async function loadAndMountApp(app) {
  const container = document.querySelector(app.container);
  if (!container) {
    console.error(`容器 ${app.container} 不存在`);
    return;
  }

  // 清空容器
  container.innerHTML = '';

  try {
    // 1. 加载子应用HTML
    const html = await fetch(app.entry).then(res => res.text());

    // 2. 解析HTML，提取JS和CSS
    const { scripts, styles, htmlContent } = parseHtml(html);

    // 3. 创建子应用容器
    const appElement = document.createElement('div');
    appElement.id = `app-${app.name}`;
    appElement.className = `micro-app micro-app-${app.name}`;
    appElement.innerHTML = htmlContent;
    container.appendChild(appElement);

    // 4. 加载CSS样式
    await loadStyles(styles, app.name);

    // 5. 执行JS代码(在沙箱中)
    await executeScripts(scripts, app);

    // 6. 调用子应用的mount方法
    if (sandbox.global[app.name] && typeof sandbox.global[app.name].mount === 'function') {
      sandbox.global[app.name].mount(appElement);
      console.log(`子应用 ${app.name} 已挂载`);
    }
  } catch (error) {
    console.error(`加载子应用 ${app.name} 失败:`, error);
  }
}

/**
 * 卸载子应用
 * @param {Object} app - 子应用配置
 */
function unmountApp(app) {
  const container = document.querySelector(app.container);
  if (container) {
    // 调用子应用的unmount方法
    if (sandbox.global[app.name] && typeof sandbox.global[app.name].unmount === 'function') {
      sandbox.global[app.name].unmount();
      console.log(`子应用 ${app.name} 已卸载`);
    }

    // 清理DOM
    container.innerHTML = '';

    // 清理样式
    // removeStylesByAppName(app.name);

    // 清理沙箱中的子应用实例
    delete sandbox.global[app.name];
  }
  activeApp = null;
}

/**
 * 解析HTML，提取JS、CSS和HTML内容
 * @param {string} html - HTML字符串
 * @returns {Object} { scripts, styles, htmlContent }
 */
function parseHtml(html) {
  const scripts = [];
  const styles = [];

  // 提取script标签
  const scriptRegex = /<script[^>]*src="([^"]+)"[^>]*><\/script>/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1]);
  }

  // 提取style标签
  const styleRegex = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }

  // 移除script和link标签后的HTML内容
  let htmlContent = html;
  htmlContent = htmlContent.replace(scriptRegex, '');
  htmlContent = htmlContent.replace(styleRegex, '');

  return { scripts, styles, htmlContent };
}

/**
 * 加载CSS样式
 * @param {Array} styles - CSS文件路径数组
 * @param {string} appName - 子应用名称
 */
async function loadStyles(styles, appName) {
  for (const styleUrl of styles) {
    try {
      const response = await fetch(styleUrl);
      const cssText = await response.text();

      // 添加样式隔离前缀
      const scopedCss = cssText.replace(/([^{]+)({)/g, (match, selector) => {
        // 跳过媒体查询和关键帧
        if (selector.includes('@media') || selector.includes('@keyframes')) {
          return match;
        }
        // 为选择器添加子应用前缀
        return `.micro-app-${appName} ${selector} {`;
      });

      // 创建style标签并添加到head
      const styleElement = document.createElement('style');
      styleElement.setAttribute('data-app', appName);
      styleElement.textContent = scopedCss;
      document.head.appendChild(styleElement);
    } catch (error) {
      console.error(`加载样式 ${styleUrl} 失败:`, error);
    }
  }
}

/**
 * 执行JS脚本
 * @param {Array} scripts - JS文件路径数组
 * @param {Object} app - 子应用配置
 */
async function executeScripts(scripts, app) {
  // 为子应用创建一个全局对象
  sandbox.global[app.name] = {};

  for (const scriptUrl of scripts) {
    try {
      const response = await fetch(scriptUrl);
      const scriptText = await response.text();

      // 在沙箱中执行脚本
      sandbox.exec(scriptText, app.name);
    } catch (error) {
      console.error(`执行脚本 ${scriptUrl} 失败:`, error);
    }
  }
}

/**
 * 创建JS沙箱
 * @returns {Object} 沙箱对象
 */
function createSandbox() {
  // 沙箱全局对象
  const global = {};

  // 存储已代理的对象，避免重复代理
  // 使用 Map 替代 WeakMap，因为 Map 有 clear() 方法
  const proxyCache = new Map();

  // 创建代理函数
  function createProxy(target, appName) {
    // 如果已经代理过，则返回缓存的代理
    if (proxyCache.has(target)) {
      return proxyCache.get(target);
    }

    const handler = {
      get(target, prop) {
        // 如果是子应用的全局对象属性
        if (global[appName] && prop in global[appName]) {
          const value = global[appName][prop];
          // 如果获取的值是对象，递归代理
          if (value && typeof value === 'object') {
            return createProxy(value, appName);
          }
          return value;
        }

        const value = target[prop];

        // 特殊处理 window 对象的属性
        if (prop === 'window' || prop === 'self' || prop === 'globalThis') {
          return sandboxProxy;
        }

        // 对常用对象进行特殊处理，避免深度递归
        if (value && typeof value === 'object') {
          // 避免对 document, location 等对象进行深度代理
          if (['document', 'location', 'navigator', 'history'].includes(prop)) {
            return value;
          }
          return createProxy(value, appName);
        }

        return value;
      },
      set(target, prop, value) {
        // 如果是子应用的全局对象属性
        if (appName && typeof value !== 'function') {
          if (!global[appName]) {
            global[appName] = {};
          }
          global[appName][prop] = value;
          return true;
        }
        target[prop] = value;
        return true;
      }
    };

    const proxy = new Proxy(target, handler);
    proxyCache.set(target, proxy);
    return proxy;
  }

  // 基础沙箱窗口对象
  const sandboxWindow = {
    ...window,
    // 子应用全局状态
    __MICRO_APP_ENVIRONMENT__: true,
    __MICRO_APP_NAME__: null,
    // 提供全局状态通信API
    setGlobalState: (state) => {
      Object.assign(globalState, state);
    },
    getGlobalState: () => {
      return { ...globalState };
    }
  };

  // 创建沙箱代理
  const sandboxProxy = createProxy(sandboxWindow, null);

  return {
    global,
    /**
     * 在沙箱中执行代码
     * @param {string} code - 代码字符串
     * @param {string} appName - 子应用名称
     */
    exec(code, appName) {
      sandboxWindow.__MICRO_APP_NAME__ = appName;
      // 重置代理缓存
      proxyCache.clear();
      // 更新沙箱代理的应用名称
      const appProxy = createProxy(sandboxWindow, appName);
      // 使用Function构造函数在沙箱中执行代码
      const func = new Function('window', 'document', 'self', 'globalThis', code);
      try {
        func(appProxy, document, appProxy, appProxy);
      } catch (error) {
        console.error(`在沙箱中执行代码失败:`, error);
      }
    }
  };
}

// 暴露API
window.registerMicroApps = registerMicroApps;
window.start = start;

// 提供导航函数
window.navigateTo = function(path) {
  window.history.pushState(null, '', path);
};