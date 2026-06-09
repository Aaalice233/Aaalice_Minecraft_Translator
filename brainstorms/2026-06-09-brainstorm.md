# Brainstorm Brief: 暗夜模式切换遮罩动画

## 当前倾向

倾向于使用 **`document.startViewTransition()` API** 实现圆形扩张遮罩动画，而非纯 CSS `clip-path` 遮罩。

### 理由

- `startViewTransition` 能自动捕获当前页面截图（旧主题的全部内容），新主题切换后浏览器在新旧截图之间执行自定义动画。
- 纯色遮罩方案（仅用 `--bg-app` 覆盖）会导致动画过程中旧主题的侧边栏、文字、按钮等 UI 元素被纯色挡住，只在圆圈边缘突然冒出，视觉上有割裂感。
- View Transition 方案效果和 iOS / macOS 系统暗色模式切换一致，所有 UI 元素通过 clip-path 圆孔平滑过渡。
- Tauri 的 WebView2（Chromium ≥ 111）完全支持。

### 被否决的方案

- **纯色 `clip-path` 遮罩（仅用 `--bg-app` 覆盖）**  
  问题：旧主题内容被纯色遮住，新内容在圆孔边缘硬切，缺少平滑感。

- **html2canvas / dom-to-image 截图**  
  问题：引入额外依赖，性能开销大，不如浏览器原生截图稳定。

## 待定细节

- 是否需要在动画期间禁用交互（`pointer-events`）？
- 动画时长（500ms 是否合适？还是应缩短到 300ms？）
- 是否需要 overshoot 缓动（如 `cubic-bezier(0.34, 1.56, 0.64, 1)`）？
- 亮→暗 和 暗→亮 是否需要不同的动画方向？

## 风险与未解决的问题

- `startViewTransition` 在 WebView2 上的实际表现需要验证（已知在特殊渲染场景下偶有闪白）。
- View Transition 的 `mix-blend-mode` 默认行为可能与自定义 `clip-path` 冲突，需要测试调校。
- 如果用户在动画期间快速多次点击，需要防抖处理（`animatingRef` 控制）。

## 实践摘要

- 讨论了圆形膨胀遮罩动画的两种实现路径：纯 CSS 遮罩 vs. 浏览器 View Transition API。
- 纯 CSS 方案因旧内容被纯色遮挡、UI 元素仅在圆孔边缘跳跃而视觉效果不够理想。
- `startViewTransition` 方案能全量截图旧页面并实现平滑 clip-path 过渡，效果更接近系统级动画。
- 用户肯定了 `startViewTransition` 建议，尚未决定是否开始实施或调整参数。