import { Account } from '../../src/domain/entities/Account';
import { AccountRepositoryPort, DepositLockResult } from '../../src/domain/ports/out/AccountRepositoryPort';
import { EventPublisherPort, DomainEvent, UserCreatedEventPayload, FundsDepositedEventPayload } from '../../src/domain/ports/out/EventPublisherPort';
import { CreateAccountService } from '../../src/application/services/CreateAccountService';
import { GetAccountService } from '../../src/application/services/GetAccountService';
import { DepositFundsService } from '../../src/application/services/DepositFundsService';
import { AccountAlreadyExistsException, AccountNotFoundException } from '../../src/domain/exceptions/DomainExceptions';

class InMemoryAccountRepository implements AccountRepositoryPort {
  public accounts: Map<string, Account> = new Map();
  public transactions: Set<string> = new Set();

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
    const found = Array.from(this.accounts.values()).find(
      (a) => a.userId === userId && a.currency === currency.toUpperCase()
    );
    return found || null;
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

    if (this.transactions.has(idempotencyKey)) {
      return { account, duplicate: true };
    }

    account.deposit(amount);
    this.transactions.add(idempotencyKey);
    return { account, duplicate: false };
  }
}

class MockEventPublisher implements EventPublisherPort {
  public publishedUserCreated: DomainEvent<UserCreatedEventPayload>[] = [];
  public publishedFundsDeposited: DomainEvent<FundsDepositedEventPayload>[] = [];
  public publishedTransferCompleted: DomainEvent<any>[] = [];

  async publishUserCreated(event: DomainEvent<UserCreatedEventPayload>): Promise<void> {
    this.publishedUserCreated.push(event);
  }

  async publishFundsDeposited(event: DomainEvent<FundsDepositedEventPayload>): Promise<void> {
    this.publishedFundsDeposited.push(event);
  }

  async publishTransferCompleted(event: DomainEvent<any>): Promise<void> {
    this.publishedTransferCompleted.push(event);
  }

  async close(): Promise<void> {}
}

describe('Application Services & Use Cases', () => {
  let repository: InMemoryAccountRepository;
  let publisher: MockEventPublisher;
  let createService: CreateAccountService;
  let getService: GetAccountService;
  let depositService: DepositFundsService;

  beforeEach(() => {
    repository = new InMemoryAccountRepository();
    publisher = new MockEventPublisher();
    createService = new CreateAccountService(repository, publisher);
    getService = new GetAccountService(repository);
    depositService = new DepositFundsService(repository, publisher);
  });

  describe('CreateAccountService (Paso-5, Paso-6, Paso-7)', () => {
    it('should create an account and publish domain event', async () => {
      const account = await createService.execute({
        userId: 'usr_100',
        currency: 'COP',
        name: 'Jane Doe',
        email: 'jane@example.com',
      });

      expect(account.userId).toBe('usr_100');
      expect(account.balance.getValue()).toBe(0);
      expect(account.currency).toBe('COP');
      expect(account.status).toBe('ACTIVE');

      expect(publisher.publishedUserCreated).toHaveLength(1);
      expect(publisher.publishedUserCreated[0].payload.userId).toBe('usr_100');
      expect(publisher.publishedUserCreated[0].payload.name).toBe('Jane Doe');
      expect(publisher.publishedUserCreated[0].payload.email).toBe('jane@example.com');
    });

    it('should prevent multiple active accounts with the same currency for a user', async () => {
      await createService.execute({ userId: 'usr_100', currency: 'COP' });

      await expect(
        createService.execute({ userId: 'usr_100', currency: 'COP' })
      ).rejects.toThrow(AccountAlreadyExistsException);
    });
  });

  describe('DepositFundsService (Pessimistic Lock & Idempotency)', () => {
    it('should deposit funds and publish wallet.funds-deposited event', async () => {
      const account = await createService.execute({ userId: 'usr_200', currency: 'COP' });

      const result = await depositService.execute({
        accountId: account.id,
        amount: 50000,
        idempotencyKey: 'idem-key-1',
        reference: 'deposit-ref-001',
      });

      expect(result.duplicate).toBe(false);
      expect(result.account.balance.getValue()).toBe(50000);
      expect(publisher.publishedFundsDeposited).toHaveLength(1);
      expect(publisher.publishedFundsDeposited[0].payload.amount).toBe('50000');
      expect(publisher.publishedFundsDeposited[0].payload.currency).toBe('COP');
    });

    it('should handle idempotent duplicate requests without re-crediting or re-publishing', async () => {
      const account = await createService.execute({ userId: 'usr_200', currency: 'COP' });

      // First call
      const res1 = await depositService.execute({
        accountId: account.id,
        amount: 50000,
        idempotencyKey: 'idem-key-duplicate',
      });
      expect(res1.duplicate).toBe(false);
      expect(res1.account.balance.getValue()).toBe(50000);

      // Duplicate retry with same idempotency key
      const res2 = await depositService.execute({
        accountId: account.id,
        amount: 50000,
        idempotencyKey: 'idem-key-duplicate',
      });
      expect(res2.duplicate).toBe(true);
      expect(res2.account.balance.getValue()).toBe(50000); // Balance NOT increased twice!

      // Event should only have been published once!
      expect(publisher.publishedFundsDeposited).toHaveLength(1);
    });
  });

  describe('GetAccountService', () => {
    it('should retrieve account by id', async () => {
      const created = await createService.execute({ userId: 'usr_300', currency: 'COP' });
      const retrieved = await getService.getById(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it('should throw AccountNotFoundException for non-existent account', async () => {
      await expect(getService.getById('non-existent-id')).rejects.toThrow(AccountNotFoundException);
    });
  });
});
