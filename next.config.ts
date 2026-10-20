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
