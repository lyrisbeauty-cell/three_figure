import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // base: './' 让打包后的 dist 可以放在任意子路径下（GitHub Pages、静态托管）
  base: './',
  build: {
    rollupOptions: {
      // 两个页面：开源模型小镇 + 办公室
      input: {
        main: resolve(root, 'index.html'),
        office: resolve(root, 'office.html'),
      },
    },
  },
});
