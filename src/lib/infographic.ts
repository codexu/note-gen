import {
  Infographic,
  setDefaultFont,
  setFontExtendFactor,
} from '@antv/infographic';

setFontExtendFactor(1.1);
setDefaultFont(
  '-apple-system-font, system-ui, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif'
);

type InfographicThemeMode = 'dark' | 'light';

interface InfographicRenderOptions {
  themeMode?: InfographicThemeMode;
}

const INFOGRAPHIC_LANGUAGE = 'infographic';
const INFOGRAPHIC_CONTAINER_CLASS = 'infographic-diagram';
const INFOGRAPHIC_MIN_HEIGHT = 120;

const DATA_PROCESSED_ATTR = 'data-infographic-processed';
const DATA_CODE_ATTR = 'data-infographic-code';
const DATA_THEME_ATTR = 'data-infographic-theme';
const DATA_RENDER_ID_ATTR = 'data-infographic-render-id';

const toHslString = (value: string) => {
  if (!value) return undefined;
  const normalized = value.replace(/\s*\/\s*/g, ' ').trim();
  const parts = normalized.split(/\s+/);
  if (parts.length === 3) {
    return `hsl(${parts.join(', ')})`;
  }
  if (parts.length === 4) {
    return `hsla(${parts.join(', ')})`;
  }
  return undefined;
};

const getThemeColors = () => {
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);
  const primary = computedStyle.getPropertyValue('--primary').trim();
  const background = computedStyle.getPropertyValue('--background').trim();

  return {
    colorPrimary: toHslString(primary),
    colorBg: toHslString(background),
  };
};

const renderInfographic = async (
  container: HTMLElement,
  code: string,
  options?: InfographicRenderOptions
) => {
  if (typeof window === 'undefined') return;

  try {
    const themeMode = options?.themeMode === 'dark' ? 'dark' : 'light';
    const renderTheme = themeMode === 'dark' ? 'dark' : 'default';
    const themeColors = getThemeColors();

    const renderId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    container.setAttribute(DATA_RENDER_ID_ATTR, renderId);

    const instance = new Infographic({
      container,
      svg: {
        style: {
          width: '100%',
          height: '100%',
          background: themeColors.colorBg || 'transparent',
        },
      },
      theme: renderTheme,
      themeConfig: {
        colorPrimary: themeColors.colorPrimary || undefined,
        colorBg: themeColors.colorBg,
      },
    });

    instance.render(code);
  } catch (error) {
    renderInfographicError(container, error);
  }
};

const renderInfographicError = (container: HTMLElement, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  container.innerHTML = `
    <div style="color: #b91c1c; padding: 10px; border: 1px solid #b91c1c; background: rgba(185, 28, 28, 0.08);">
      Infographic 渲染失败: ${message}
    </div>
  `;
};

const getInfographicCode = (element: HTMLElement) => {
  const cached = element.getAttribute(DATA_CODE_ATTR);
  if (cached) return cached;
  return element.textContent || '';
};

const ensureInfographicContainer = (element: HTMLElement) => {
  const existing = element.querySelector<HTMLElement>(
    `.${INFOGRAPHIC_CONTAINER_CLASS}`
  );
  if (existing) return existing;

  const container = document.createElement('div');
  container.className = INFOGRAPHIC_CONTAINER_CLASS;
  container.style.width = '100%';
  container.style.minHeight = `${INFOGRAPHIC_MIN_HEIGHT}px`;
  container.style.overflow = 'hidden';
  container.textContent = '正在加载 Infographic...';

  element.innerHTML = '';
  element.appendChild(container);
  return container;
};

const getInfographicNodes = (element: HTMLElement) => {
  const nodes = new Set<HTMLElement>();
  if (element.classList.contains(`language-${INFOGRAPHIC_LANGUAGE}`)) {
    nodes.add(element);
  }
  element
    .querySelectorAll<HTMLElement>(`.language-${INFOGRAPHIC_LANGUAGE}`)
    .forEach((node) => nodes.add(node));
  return Array.from(nodes);
};

export const infographicRenderer = {
  language: INFOGRAPHIC_LANGUAGE,
  render: (element: HTMLElement) => {
    // Tiptap doesn't use this renderer, but keep for compatibility
    const themeMode = 'light';
    renderInfographicElements(element, { themeMode });
  },
};

export const renderInfographicElements = (
  element: HTMLElement,
  options?: InfographicRenderOptions
) => {
  if (typeof window === 'undefined') return;

  const themeMode = options?.themeMode === 'dark' ? 'dark' : 'light';
  const nodes = getInfographicNodes(element);

  nodes.forEach((node) => {
    const code = getInfographicCode(node).trim();
    if (!code) return;

    const previousCode = node.getAttribute(DATA_CODE_ATTR);
    const previousTheme = node.getAttribute(DATA_THEME_ATTR);
    const processed = node.getAttribute(DATA_PROCESSED_ATTR) === 'true';

    if (processed && previousCode === code && previousTheme === themeMode) {
      return;
    }

    node.setAttribute(DATA_CODE_ATTR, code);
    node.setAttribute(DATA_THEME_ATTR, themeMode);
    node.setAttribute(DATA_PROCESSED_ATTR, 'true');

    const container = ensureInfographicContainer(node);
    container.textContent = '正在加载 Infographic...';
    void renderInfographic(container, code, { themeMode });
  });
};
