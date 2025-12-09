# TitleBar 拖拽栏实现说明

## 修改概述
为 PC 端添加了自定义拖拽栏，同时保持原生的关闭/最小化/最大化按钮，兼容 Windows、Linux、macOS。

## 修改的文件

### 1. 新增文件
- **`/src/components/title-bar.tsx`**: 自定义拖拽栏组件
  - 检测平台（macOS/Windows/Linux）
  - macOS: 左侧留出 70px 给红绿灯按钮
  - Windows/Linux: 右侧留出 138px 给控制按钮
  - 使用 `startDragging()` API 实现窗口拖拽
  - 移动端不显示

### 2. 配置文件
- **`/src-tauri/tauri.conf.json`**
  - 添加 `"titleBarStyle": "Overlay"`
  - macOS: 隐藏标题栏但保留红绿灯按钮
  - Windows/Linux: 保持原生窗口装饰

### 3. 布局文件修改

#### `/src/app/core/layout.tsx`
- 导入并渲染 `TitleBar` 组件
- `SidebarInset`: 添加 `h-[calc(100vh-36px)] mt-9 min-h-0`
- `main`: 添加 `h-full`

#### `/src/components/app-sidebar.tsx`
- 修改 `Sidebar` className: `h-[calc(100vh-36px)] mt-9`

#### 页面组件（将 `h-screen` 改为 `h-full`）
- `/src/app/core/record/page.tsx` - ResizablePanelGroup
- `/src/app/core/record/mark/index.tsx` - NoteSidebar
- `/src/app/core/record/chat/index.tsx` - Chat
- `/src/app/core/article/page.tsx` - ResizablePanelGroup
- `/src/app/core/article/file/index.tsx` - FileSidebar
- `/src/app/core/article/md-editor.tsx` - 编辑器容器
- `/src/app/core/image/page.tsx` - 图片页面
- `/src/app/core/setting/layout.tsx` - 设置页面布局
- `/src/app/core/setting/page.tsx` - 设置页面
- `/src/app/core/setting/components/setting-tab.tsx` - 设置标签

## 布局高度链条

```
TitleBar (fixed, h-36px)
  ↓
Sidebar (h-[calc(100vh-36px)] mt-9)
  ↓
SidebarInset (h-[calc(100vh-36px)] mt-9 min-h-0)
  ↓
main (h-full)
  ↓
ResizablePanelGroup (h-full)
  ↓
所有子组件 (h-full)
```

## 关键点

1. **TitleBar 高度**: 36px (`h-[36px]`)
2. **避开原生按钮**:
   - macOS: `paddingLeft: 70px`
   - Windows/Linux: `paddingRight: 138px`
3. **高度计算**: 所有容器使用 `calc(100vh - 36px)` 或 `h-full`
4. **覆盖默认样式**: `SidebarInset` 需要 `min-h-0` 覆盖默认的 `min-h-svh`

## 测试方法

重启 Tauri 开发服务器：
```bash
pnpm tauri dev
```

## 注意事项

- `titleBarStyle: "Overlay"` 在不同平台的行为不同
- macOS: 效果最佳，红绿灯按钮叠加在内容上
- Windows/Linux: 可能需要进一步调整
- 如需完全自定义标题栏（包括按钮），需设置 `decorations: false` 并自行实现控制按钮
