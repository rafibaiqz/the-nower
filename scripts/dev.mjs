// Runs the game server (watch mode) and the Vite client together: `npm run dev`.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '-w', 'server'], { stdio: 'inherit', env: { ...process.env, CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? '*' } }),
  spawn('npm', ['run', 'dev', '-w', 'client'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && code !== 0 && stop());
