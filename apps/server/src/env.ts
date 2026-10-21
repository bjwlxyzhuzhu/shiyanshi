import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env 可选，格式错误时忽略，使用默认配置
  }
}
