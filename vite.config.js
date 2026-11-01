import { defineConfig } from 'vite';

// base: './' 让打包后的 dist 可以放在任意子路径下（GitHub Pages、静态托管）
export default defineConfig({
  base: './',
});
