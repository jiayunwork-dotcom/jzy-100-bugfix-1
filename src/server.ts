/**
 * 服务入口：把接口绑在固定端口上（默认 8080，可用 PORT 覆盖）。
 */
import { buildApp } from './routes';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = '0.0.0.0';

async function main(): Promise<void> {
  const app = buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`keyword-extraction-service listening on ${HOST}:${PORT}`);
  } catch (err) {
    console.error('failed to start server:', err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
