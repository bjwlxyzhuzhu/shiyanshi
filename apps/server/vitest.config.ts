import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // 每个测试文件独立进程与临时数据库，互不影响，也不触碰 data/zhian.sqlite
    pool: 'forks'
  }
});
