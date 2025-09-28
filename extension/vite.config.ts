import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { defineConfig } from 'vite';

const distDir = resolve(__dirname, 'dist');

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const ensureCopied = async (from: string, to: string): Promise<void> => {
  if (!(await fileExists(from))) {
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
};

const postBuildPlugin = () => ({
  name: 'nebula-post-build',
  apply: 'build',
  async closeBundle() {
    await ensureCopied(resolve(__dirname, 'manifest.json'), join(distDir, 'manifest.json'));
    await ensureCopied(resolve(__dirname, 'public/welcome.html'), join(distDir, 'welcome.html'));

    const popupHtml = resolve(distDir, 'src/ui/popup/index.html');
    const sidebarHtml = resolve(distDir, 'src/ui/sidebar/index.html');
    await ensureCopied(popupHtml, join(distDir, 'popup/index.html'));
    await ensureCopied(sidebarHtml, join(distDir, 'sidebar/index.html'));

    const cssAssetPath = join(distDir, 'contentStyles.css');
    if (await fileExists(cssAssetPath)) {
      await ensureCopied(cssAssetPath, join(distDir, 'content.css'));
    } else {
      const assetsDir = resolve(distDir, 'assets');
      try {
        const assets = await readdir(assetsDir);
        const cssAsset = assets.find(asset => asset.startsWith('contentStyles') && asset.endsWith('.css'));
        if (cssAsset) {
          await ensureCopied(join(assetsDir, cssAsset), join(distDir, 'content.css'));
        }
      } catch {
        // ignore missing assets directory
      }
    }

    // Re-bundle the content script as an IIFE so it can run as a classic MV3 content script
    await esbuild({
      entryPoints: [resolve(__dirname, 'src/content.ts')],
      bundle: true,
      format: 'iife',
      target: ['chrome110'],
      outfile: join(distDir, 'content.js'),
      platform: 'browser',
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      },
    });

    await rm(resolve(distDir, 'src'), { recursive: true, force: true });
  },
});

export default defineConfig({
  plugins: [react(), postBuildPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        sidebar: resolve(__dirname, 'src/ui/sidebar/index.html'),
        contentStyles: resolve(__dirname, 'src/content.css'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    target: 'es2022',
    minify: false, // Keep readable for development
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  envDir: __dirname,
});
