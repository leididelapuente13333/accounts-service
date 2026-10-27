import { Account } from '../../entities/Account';

export interface DepositFundsCommand {
  accountId: string;
  amount: number;
  idempotencyKey: string;
  reference?: string;
  name?: string;
  email?: string;
}

export interface DepositFundsResult {
  account: Account;
  duplicate: boolean;
  reference?: string;
  idempotencyKey: string;
}

export interface DepositFundsUseCase {
  execute(command: DepositFundsCommand): Promise<DepositFundsResult>;
}
