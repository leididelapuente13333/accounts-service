import { config } from './infrastructure/config/environment';
import { pool, closePool } from './infrastructure/database/postgresPool';
import { runMigrations } from './infrastructure/database/migrations';
import { PostgresAccountRepository } from './infrastructure/database/PostgresAccountRepository';
import { RabbitMQEventPublisher } from './infrastructure/messaging/RabbitMQEventPublisher';
import { CreateAccountService } from './application/services/CreateAccountService';
import { GetAccountService } from './application/services/GetAccountService';
import { DepositFundsService } from './application/services/DepositFundsService';
import { AccountController } from './infrastructure/web/controllers/AccountController';
import { createApp } from './app';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('  Accounts & Wallet Microservice Starting Up...    ');
  console.log('----------------------------------------------------');

  // 1. Initialize Database & Run Migrations
  try {
    console.log('[Bootstrap] Initializing PostgreSQL schema & migrations...');
    await runMigrations(pool);
  } catch (err) {
    console.error('[Bootstrap] Fatal error running database migrations:', err);
    process.exit(1);
  }

  // 2. Initialize RabbitMQ Publisher
  const eventPublisher = new RabbitMQEventPublisher();
  try {
    console.log('[Bootstrap] Connecting to RabbitMQ broker...');
    await eventPublisher.init();
  } catch (err: any) {
    console.warn('[Bootstrap] Warning: Initial RabbitMQ connection failed. Will retry on publish:', err.message);
  }

  // 3. Assemble Hexagonal Architecture (Adapters -> Ports -> Application)
  const accountRepository = new PostgresAccountRepository(pool);

  const createAccountService = new CreateAccountService(
    accountRepository,
    eventPublisher,
    config.usersServiceUrl
  );
  const getAccountService = new GetAccountService(accountRepository);
  const depositFundsService = new DepositFundsService(
    accountRepository,
    eventPublisher,
    config.usersServiceUrl
  );

  const accountController = new AccountController(
    createAccountService,
    getAccountService,
    depositFundsService
  );

  const app = createApp(accountController);

  // 4. Start HTTP Server
  const server = app.listen(config.port, () => {
    console.log(`[Bootstrap] HTTP Server running on port ${config.port}`);
    console.log(`[Bootstrap] Swagger UI available at: http://localhost:${config.port}/api-docs`);
    console.log(`[Bootstrap] Health check available at: http://localhost:${config.port}/health`);
    console.log('----------------------------------------------------');
  });

  // 5. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      console.log('[Shutdown] HTTP server closed.');

      try {
        await eventPublisher.close();
      } catch (err) {
        console.error('[Shutdown] Error closing RabbitMQ:', err);
      }

      try {
        await closePool();
        console.log('[Shutdown] Database connection pool closed.');
      } catch (err) {
        console.error('[Shutdown] Error closing database pool:', err);
      }

      console.log('[Shutdown] Service successfully terminated.');
      process.exit(0);
    });

    // Force exit if shutdown hangs beyond 10s
    setTimeout(() => {
      console.error('[Shutdown] Forcefully shutting down due to timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Unexpected fatal error:', err);
  process.exit(1);
});
