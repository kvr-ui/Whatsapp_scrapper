import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the tracing root to this project. Without it Next.js walks up and finds
  // an unrelated lockfile in the parent directory, which skews what gets
  // bundled into the serverless functions.
  outputFileTracingRoot: path.join(__dirname),

  // whatsapp-web.js, puppeteer-core and @sparticuz/chromium must stay external:
  // they load native/binary assets at runtime that the bundler cannot inline.
  serverExternalPackages: [
    'whatsapp-web.js',
    'puppeteer-core',
    '@sparticuz/chromium',
    'wwebjs-mongo',
    'mongoose',
  ],
  // Externalising a package stops the bundler relocating it, but the tracer
  // still only ships files something statically imports. The Chromium build is
  // read from disk by path at runtime, so bin/*.br is invisible to tracing and
  // the function starts without it ("input directory ... does not exist").
  // Listed explicitly, and only on the three routes that launch a browser, so
  // the other functions stay small.
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/whatsapp-web.js/**'],
    '/api/sync': ['./node_modules/@sparticuz/chromium/**'],
    '/api/cron/weekly': ['./node_modules/@sparticuz/chromium/**'],
    '/api/whatsapp/link': ['./node_modules/@sparticuz/chromium/**'],
  },
};

export default nextConfig;
