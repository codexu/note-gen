import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const internalHost = process.env.TAURI_DEV_HOST || 'localhost';
// Fork（almanac P0.5）：別的 worktree 用 `PORT=3457 npx next dev` 開第二個 dev server 時，資源路徑跟著埠走。
const devPort = process.env.PORT || '3456';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
  output: "export",
  images: {
    unoptimized: true,
  },
  assetPrefix: isProd ? undefined : `http://${internalHost}:${devPort}`,
  sassOptions: {
    silenceDeprecations: ['legacy-js-api'],
  },
  reactStrictMode: false,
  turbopack: {},
  devIndicators: false,
};

const configuredNext = withNextIntl(nextConfig);

// next-intl 3.x still injects its Turbopack alias through the deprecated
// experimental.turbo key. Normalize the plugin output for Next.js 15.3.
const legacyTurbo = configuredNext.experimental?.turbo;
if (legacyTurbo) {
  configuredNext.turbopack = { ...legacyTurbo, ...configuredNext.turbopack };
  if (configuredNext.experimental) delete configuredNext.experimental.turbo;
}

export default configuredNext;
