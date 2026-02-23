import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const internalHost = process.env.TAURI_DEV_HOST || 'localhost';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
  output: "export",
  images: {
    unoptimized: true,
  },
  assetPrefix: isProd ? undefined : `http://${internalHost}:3456`,
  sassOptions: {
    silenceDeprecations: ['legacy-js-api'],
  },
  reactStrictMode: false,
  turbopack: {},
  devIndicators: false,
  webpack: (config) => {
    // 过滤掉 flushSync 警告 - 来自 Tiptap 编辑器的已知问题
    config.stats = {
      ...config.stats,
      warningsFilter: (warning: string) => {
        return !warning.includes('flushSync');
      }
    };
    return config;
  }
};

export default withNextIntl(nextConfig);
