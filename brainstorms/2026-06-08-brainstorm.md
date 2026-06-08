# Brainstorm Brief: 页面切换动画

## Current leaning

用户偏向使用 **纯 CSS 实现微缩放 + 淡入 (Scale+Fade)** 页面切换动画，零额外依赖。方案核心参数已基本确定，但尚未进入实现阶段，仍处于方案确认状态。

### 已确定的参数

| 参数 | 值 |
|------|-----|
| 动画类型 | 缩放 (0.98→1.0) + 透明度淡入淡出 |
| 时长 | **150ms** |
| 缩放幅度 | 非活跃页 `scale(0.98)` → 活跃页 `scale(1)`（2% 缩放） |
| 交叠时层级 | **退出页在上层**（旧页面覆盖在新页面上淡出缩小） |
| 技术方案 | **纯 CSS transition**，无需引入新依赖 |

## 已讨论并确定的事项

- 交叠层级策略：选定退出页在上层，采用轻量 React 状态（`exitingPage` + `setTimeout(150ms)` 清理）管理退出动画
- GPU 合成层开销：用户**接受**始终保持非活跃页面在 GPU 合成层中（桌面端影响很小）

## 替代方案考虑

- **Framer Motion**: 更丰富的动画控制能力，但增加约 30KB bundle 体积，被用户否决（倾向纯 CSS）
- **View Transitions API**: 浏览器原生 API，Chromium 支持，但浏览器兼容性不如纯 CSS 方案，未被用户选中
- **纯 fade 淡入淡出**: 最轻量但无缩放效果，用户选择了更有呼吸感的 Scale+Fade
- **滑动 + 淡入 (Slide+Fade)**: 方向感更强，但用户偏好的 Scale+Fade 更微妙适合工具型应用

## 已评估的权衡

- **GPU 内存开销**: 用户接受。从 `display: none` 改为 `opacity: 0` 后，所有已挂载页面持续保留在 GPU 合成层中，桌面端影响很小
- **层级管理**: 采用 `exitingPage` + `setTimeout(150ms)` 管理退出层 z-index，代码量少且逻辑清晰
- **挂载机制**: keep-alive 模式与 `opacity: 0` 共存，通过 `mountedPages` Set 控制挂载，不产生意外重新挂载

## Transcript Summary

用户提出想给页面切换添加动画，助手查看了当前代码中的页面路由结构（基于 activePage 状态 + display: none/flex 控制显隐的 keep-alive 方案），讨论了淡入淡出、滑动、微缩放等动画风格的可选方案，用户选择了微缩放 + 淡入；对话继续讨论了技术实现方式（纯 CSS、View Transitions API、Framer Motion），用户选择了纯 CSS；最后用户逐一确认了动画时长 150ms、缩放幅度 0.98→1.0、退出页在上层等具体参数。