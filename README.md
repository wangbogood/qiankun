## 将所有微服务所用到的知识点总结到了learnDian文件中

下面我将带你**从零手写一个简化版的 `qiankun` 微前端框架**，帮助你理解其核心原理。

> 🌟 目标：实现一个轻量级的微前端框架，支持：
> - 主应用（Main App）加载子应用（Sub App）
> - 子应用隔离（JS、CSS 沙箱）
> - 路由劫持与生命周期管理
> - HTML Entry（通过 URL 加载子应用）

我们称它为：**MiniQiankun**

---

## 🔧 核心原理回顾（qiankun 做了什么？）

1. **HTML Entry**：通过 `fetch` 加载子应用的 HTML，提取 JS/CSS
2. **沙箱机制**：JS 沙箱（Proxy 模拟 window 隔离），CSS 隔离（动态加前缀或 Shadow DOM）
3. **生命周期**：`bootstrap`, `mount`, `unmount`
4. **路由劫持**：监听 `popstate` 和 `pushState`，动态加载子应用
5. **通信机制**：全局状态共享（可选）

---

## 📁 项目结构（单文件实现，便于理解）

我们将所有逻辑写在一个 JS 文件中，主应用引入即可。

---

## ✅ 第一步：主应用 HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MiniQiankun - Main App</title>
  <style>
    #nav {
      padding: 10px;
      background: #f0f0f0;
    }
    #nav a {
      margin-right: 15px;
      text-decoration: none;
      color: #007acc;
    }
    #subapp-container {
      margin-top: 20px;
      border: 1px solid #ddd;
      min-height: 300px;
      padding: 10px;
    }
  </style>
</head>
<body>
  <h1>🚀 MiniQiankun - 主应用</h1>

  <div id="nav">
    <a href="/app-vue">Vue 子应用</a>
    <a href="/app-react">React 子应用</a>
    <a href="/">首页</a>
  </div>

  <!-- 子应用挂载点 -->
  <div id="subapp-container"></div>

  <!-- 引入我们手写的 mini-qiankun -->
  <script src="./mini-qiankun.js"></script>

  <!-- 注册子应用 -->
  <script>
    registerMicroApp({
      name: 'app-vue',
      entry: '//localhost:5001', // 子应用地址
      container: '#subapp-container',
      activeRule: '/app-vue'
    });

    registerMicroApp({
      name: 'app-react',
      entry: '//localhost:5002',
      container: '#subapp-container',
      activeRule: '/app-react'
    });

    // 启动微前端
    start();
  </script>
</body>
</html>
```

---

## ✅ 第二步：手写 `mini-qiankun.js`

```js
// mini-qiankun.js

// 存储所有子应用
const microApps = [];
const apps = [];

// 注册子应用
function registerMicroApp(app) {
  microApps.push(app);
}

// 启动 qiankun
function start() {
  // 第一次检查匹配的子应用
  reroute();

  // 监听浏览器路由变化（前进后退）
  window.addEventListener('popstate', reroute);
  // 拦截 pushState 和 replaceState
  patchRouter();
}

// 路由劫持
function patchRouter() {
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;

  window.history.pushState = function (...args) {
    const result = originalPush.apply(this, args);
    reroute();
    return result;
  };

  window.history.replaceState = function (...args) {
    const result = originalReplace.apply(this, args);
    reroute();
    return result;
  };
}

// 重新路由：判断当前 URL 应该加载哪个子应用
async function reroute() {
  const pathname = window.location.pathname;

  // 卸载不匹配的
  const unmountApps = apps
    .filter(app => app.status === 'MOUNTED')
    .filter(app => !microApps.some(m => m.activeRule === pathname || pathname.startsWith(m.activeRule)));

  for (const app of unmountApps) {
    await app.unmount();
    app.status = 'NOT_MOUNTED';
  }

  // 加载并挂载匹配的
  const matchApp = microApps.find(m => pathname === m.activeRule || pathname.startsWith(m.activeRule));

  if (matchApp) {
    let app = apps.find(a => a.name === matchApp.name);

    if (!app) {
      app = await loadMicroApp(matchApp);
      apps.push(app);
    }

    if (app.status === 'NOT_MOUNTED') {
      await app.mount();
      app.status = 'MOUNTED';
    }
  }
}

// 加载子应用
async function loadMicroApp(config) {
  let status = 'NOT_LOADED';

  const container = document.querySelector(config.container);

  let app = {
    name: config.name,
    status,
    config,
    container,
    // 生命周期函数
    bootstrap: async () => {},
    mount: async () => {},
    unmount: async () => {}
  };

  // 1. 获取子应用 HTML
  const resp = await fetch(config.entry);
  const html = await resp.text();

  // 2. 解析 HTML，提取 JS 和 CSS
  const { scripts, styles } = parseHTML(html, config.entry);

  // 3. 加载 CSS
  await Promise.all(styles.map(downloadAsset));

  // 4. 加载并执行 JS（带沙箱）
  app.bootstrap = async () => {
    status = 'BOOTSTRAPPING';
    console.log(`[MiniQiankun] ${config.name} bootstrapping`);
    status = 'NOT_MOUNTED';
  };

  app.mount = async () => {
    status = 'MOUNTING';
    console.log(`[MiniQiankun] ${config.name} mounting`);

    // 清空容器
    container.innerHTML = '';

    // 插入 HTML 内容（不含 script）
    const div = document.createElement('div');
    div.innerHTML = html;
    const appContent = extractMainContent(div, config.name);
    container.appendChild(appContent);

    // 创建 JS 沙箱
    const sandbox = new Sandbox(config.name);
    sandbox.inject();

    // 执行所有脚本
    for (const script of scripts) {
      const code = await downloadAsset(script);
      // 模拟 webpack 的模块系统
      const wrappedCode = `
        (function(global, window, self, document){
          ${code}
        })(window, window, window, window);
      `;
      new Function(wrappedCode)();
    }

    sandbox.release();

    status = 'MOUNTED';
  };

  app.unmount = async () => {
    status = 'UNMOUNTING';
    console.log(`[MiniQiankun] ${config.name} unmounting`);
    container.innerHTML = '';
    status = 'NOT_MOUNTED';
  };

  return app;
}

// 解析 HTML，提取 JS 和 CSS 资源
function parseHTML(html, baseUrl) {
  const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  const inlineScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const styleRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const inlineStyleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;

  const scripts = [];
  const styles = [];

  // 提取外链 JS
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(new URL(match[1], baseUrl).href);
  }
  // 提取内联 JS（可选执行）
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    scripts.push({ type: 'inline', content: match[1] });
  }

  // 提取外链 CSS
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(new URL(match[1], baseUrl).href);
  }
  // 提取内联 CSS
  while ((match = inlineStyleRegex.exec(html)) !== null) {
    styles.push({ type: 'inline', content: match[1] });
  }

  return { scripts, styles };
}

// 下载资源
async function downloadAsset(url) {
  if (typeof url === 'object' && url.type === 'inline') {
    return url.content;
  }
  const resp = await fetch(url);
  return await resp.text();
}

// 提取主内容（去掉 script 和 style）
function extractMainContent(div, appName) {
  div.querySelectorAll('script').forEach(s => s.remove());
  div.querySelectorAll('style, link[rel="stylesheet"]').forEach(s => s.remove());
  // 添加隔离样式前缀（简单实现）
  addStylePrefix(div, appName);
  return div;
}

// 简单 CSS 隔离：给所有元素加 data-prefix
function addStylePrefix(container, prefix) {
  const elements = container.querySelectorAll('*');
  for (const el of elements) {
    el.setAttribute('data-qk-prefix', prefix);
  }
  // 可注入 scoped CSS（略）
}

// JS 沙箱（简易版，基于 Proxy）
class Sandbox {
  constructor(name) {
    this.name = name;
    this.proxy = new Proxy(window, {
      set: (target, prop, value) => {
        console.log(`[Sandbox ${this.name}] Set window.${String(prop)} =`, value);
        target[prop] = value;
        return true;
      },
      get: (target, prop) => {
        return target[prop];
      }
    });
  }

  inject() {
    // 临时替换 window（不完美，仅示意）
    this.originalWindow = window;
    globalThis.window = this.proxy;
    globalThis.self = this.proxy;
  }

  release() {
    globalThis.window = this.originalWindow;
    globalThis.self = this.originalWindow;
  }
}

// 暴露 API
window.registerMicroApp = registerMicroApp;
window.start = start;
```

---

## ✅ 第三步：子应用要求（Vue/React）

子应用需支持 `umd` 打包，并导出生命周期钩子：

```js
// 子应用 entry（如 Vue 项目中）
if (window.__MICRO_APP_ENV__) {
  __webpack_public_path__ = window.__MICRO_APP_PUBLIC_PATH__;

  window['app-vue'] = {
    bootstrap: () => Promise.resolve(),
    mount: ({ container }) => {
      app.mount(container);
      return Promise.resolve();
    },
    unmount: () => {
      app.unmount();
      return Promise.resolve();
    }
  };
}
```

### Vue Vite 配置示例（vite.config.js）

```js
export default defineConfig({
  build: {
    lib: {
      entry: 'src/entry.ts',
      name: 'appVue',
      formats: ['umd'],
      fileName: 'index'
    }
  }
});
```

---

## ✅ 运行方式

1. 子应用分别运行在 `http://localhost:5001`（Vue）、`5002`（React）
2. 主应用运行在 `http://localhost:5000`
3. 访问主应用，点击链接，子应用自动加载

---

## 🔒 沙箱增强（可选）

- **严格沙箱**：记录所有修改的属性，卸载时还原
- **Proxy 沙箱**：拦截 `window` 属性读写
- **Snapshot 沙箱**：快照方式（适用于不支持 Proxy 的环境）

---

## 🚀 总结：MiniQiankun 核心模块

| 模块 | 实现 |
|------|------|
| 路由劫持 | `pushState/replaceState` 拦截 + `popstate` |
| HTML Entry | `fetch + 正则解析` |
| 资源加载 | `fetch` 加载 JS/CSS |
| JS 沙箱 | `Proxy` 模拟 window 隔离 |
| CSS 隔离 | `data-prefix` 或 Shadow DOM |
| 生命周期 | `bootstrap/mount/unmount` |

---

## 📚 延伸学习

- qiankun 源码：https://github.com/umijs/qiankun
- single-spa：https://single-spa.js.org
- Module Federation（Webpack 5 微前端）

---

如果你想，我可以：
- 提供 Vue/React 子应用完整示例
- 实现通信机制（`initGlobalState`）
- 支持预加载、懒加载、错误处理

是否需要我继续扩展？比如生成完整项目结构或支持 Module Federation？