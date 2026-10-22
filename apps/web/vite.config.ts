import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true
      },
      // 实验空间入口：由后端换票后 303 回到前端干净地址
      '/ilab': {
        target: 'http://localhost:8788',
        changeOrigin: true
      }
    }
  }
});
