import { spawn } from 'child_process';

console.log('🚀 Starting ITMS Full Development Environment...');
console.log('⚡ Spawning WebSocket Runtime Server (Port 3001)...');

const wsProcess = spawn('npx', ['tsx', 'server/index.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

console.log('🌐 Spawning Next.js Dev Server (Port 3000)...');

const nextProcess = spawn('npx', ['next', 'dev', '--turbopack'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

const cleanup = (code?: number) => {
  wsProcess.kill();
  nextProcess.kill();
  process.exit(code || 0);
};

wsProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ WebSocket process exited with code ${code}`);
  }
});

nextProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Next.js process exited with code ${code}`);
  }
});

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in dev launcher:', err);
  cleanup(1);
});
