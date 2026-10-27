import request from 'supertest';
import { createApp } from '../../src/app';
import { Account } from '../../src/domain/entities/Account';
import { AccountRepositoryPort, DepositLockResult } from '../../src/domain/ports/out/AccountRepositoryPort';
import { EventPublisherPort } from '../../src/domain/ports/out/EventPublisherPort';
import { CreateAccountService } from '../../src/application/services/CreateAccountService';
import { GetAccountService } from '../../src/application/services/GetAccountService';
import { DepositFundsService } from '../../src/application/services/DepositFundsService';
import { AccountController } from '../../src/infrastructure/web/controllers/AccountController';
import { AccountAlreadyExistsException, AccountNotFoundException } from '../../src/domain/exceptions/DomainExceptions';

class InMemoryAccountRepo implements AccountRepositoryPort {
  private accounts = new Map<string, Account>();
  private idempotencyKeys = new Set<string>();

  async save(account: Account): Promise<void> {
    const existing = await this.findByUserIdAndCurrency(account.userId, account.currency);
    if (existing && existing.status === 'ACTIVE') {
      throw new AccountAlreadyExistsException(account.userId, account.currency);
    }
    this.accounts.set(account.id, account);
  }

  async findById(id: string): Promise<Account | null> {
    return this.accounts.get(id) || null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter((a) => a.userId === userId);
  }

  async findByUserIdAndCurrency(userId: string, currency: string): Promise<Account | null> {
    return (
      Array.from(this.accounts.values()).find(
        (a) => a.userId === userId && a.currency === currency.toUpperCase()
      ) || null
    );
  }

  async depositWithPessimisticLock(
    accountId: string,
    amount: number,
    idempotencyKey: string,
    _reference?: string
  ): Promise<DepositLockResult> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new AccountNotFoundException(accountId);
    }
    if (this.idempotencyKeys.has(idempotencyKey)) {
      return { account, duplicate: true };
    }
    account.deposit(amount);
    this.idempotencyKeys.add(idempotencyKey);
    return { account, duplicate: false };
  }
}

const mockPublisher: EventPublisherPort = {
  publishUserCreated: jest.fn().mockResolvedValue(undefined),
  publishFundsDeposited: jest.fn().mockResolvedValue(undefined),
  publishTransferCompleted: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

describe('API Endpoints (HTTP Integration)', () => {
  let app: any;
  let repo: InMemoryAccountRepo;

  beforeEach(() => {
    repo = new InMemoryAccountRepo();
    const createService = new CreateAccountService(repo, mockPublisher);
    const getService = new GetAccountService(repo);
    const depositService = new DepositFundsService(repo, mockPublisher);
    const controller = new AccountController(createService, getService, depositService);
    app = createApp(controller);
  });

  describe('GET /health', () => {
    it('should return 200 with status UP', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'UP' });
    });
  });

  describe('GET /api-docs', () => {
    it('should serve Swagger UI documentation', async () => {
      const res = await request(app).get('/api-docs/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('swagger');
    });
  });

  describe('POST /api/accounts', () => {
    it('should create an account with status ACTIVE and initial balance 0', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_abc_123', currency: 'COP' });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe('usr_abc_123');
      expect(res.body.currency).toBe('COP');
      expect(res.body.balance).toBe(0);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.id).toBeDefined();
    });

    it('should return 409 when user already has an active account in same currency', async () => {
      await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_abc_123', currency: 'COP' });

      const res = await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_abc_123', currency: 'COP' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('AccountAlreadyExistsException');
    });

    it('should return 400 when missing required userId', async () => {
      const res = await request(app).post('/api/accounts').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });
  });

  describe('GET /api/accounts/:id and /api/accounts/user/:userId', () => {
    it('should retrieve account by id and user id', async () => {
      const created = await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_def_456', currency: 'COP' });
      const accountId = created.body.id;

      // By Account ID
      const resById = await request(app).get(`/api/accounts/${accountId}`);
      expect(resById.status).toBe(200);
      expect(resById.body.id).toBe(accountId);

      // By User ID
      const resByUser = await request(app).get('/api/accounts/user/usr_def_456');
      expect(resByUser.status).toBe(200);
      expect(Array.isArray(resByUser.body)).toBe(true);
      expect(resByUser.body[0].id).toBe(accountId);
    });

    it('should return 404 for non-existent account ID', async () => {
      const res = await request(app).get('/api/accounts/non-existent-uuid');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/accounts/:id/deposit', () => {
    it('should deposit funds, update balance, and handle idempotency', async () => {
      const created = await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_dep_789', currency: 'COP' });
      const accountId = created.body.id;

      // First deposit
      const res1 = await request(app)
        .post(`/api/accounts/${accountId}/deposit`)
        .send({
          amount: 50000,
          idempotencyKey: 'idemp-tx-1001',
          reference: 'ref-deposit-123',
        });

      expect(res1.status).toBe(200);
      expect(res1.body.account.balance).toBe(50000);
      expect(res1.body.duplicate).toBe(false);
      expect(res1.body.reference).toBe('ref-deposit-123');

      // Duplicate deposit with same idempotency key
      const res2 = await request(app)
        .post(`/api/accounts/${accountId}/deposit`)
        .send({
          amount: 50000,
          idempotencyKey: 'idemp-tx-1001',
          reference: 'ref-deposit-123',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.duplicate).toBe(true);
      expect(res2.body.account.balance).toBe(50000); // Balance should remain 50000
    });

    it('should reject deposit with non-positive amount', async () => {
      const created = await request(app)
        .post('/api/accounts')
        .send({ userId: 'usr_dep_999', currency: 'COP' });

      const res = await request(app)
        .post(`/api/accounts/${created.body.id}/deposit`)
        .send({
          amount: -500,
          idempotencyKey: 'idemp-neg',
        });

      expect(res.status).toBe(400);
    });
  });
});
