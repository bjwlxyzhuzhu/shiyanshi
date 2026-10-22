import './env.js';
import { createApp } from './app.js';
import { ilabConfig } from './ilab/config.js';

const port = Number(process.env.API_PORT ?? 8788);
createApp().listen(port, () => {
  const config = ilabConfig();
  console.log(`[zhian] server listening on http://localhost:${port}`);
  console.log(`[zhian] ILAB mode=${config.mode} network=${config.networkEnabled ? 'on' : 'off'}`);
});
