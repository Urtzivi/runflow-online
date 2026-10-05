'use strict';

// Single entry point for every environment (Render, Docker, start.bat).
// Each hook wraps http.createServer, so the order matters: the first one
// loaded is the outermost layer and sees every request first.
const HOOKS = [
  './rate-limit-hook.js',
  './publish-safety-hook.js',
  './planned-load-hook.js',
  './plan-delete-hook.js',
  './season-delete-hook-v2.js',
  './auth-recovery-hook.js',
  './athlete-link-recovery-hook.js',
  './learning-api-hook.js',
  './library-policy-hook.js',
  './v9-engine-hook.js',
  './v9-supplement-hook.js',
  './v9-reschedule-hook.js',
  './football-api-hook.js',
  './assistant-api-hook.js',
];

for (const hook of HOOKS) require(hook);
require('./server.js');
