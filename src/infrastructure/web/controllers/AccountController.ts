import { NextFunction, Request, Response } from 'express';
import { CreateAccountSchema } from '../../../application/dtos/CreateAccountDto';
import { DepositFundsSchema } from '../../../application/dtos/DepositFundsDto';
import { toAccountResponseDto } from '../../../application/dtos/AccountResponseDto';
import { CreateAccountUseCase } from '../../../domain/ports/in/CreateAccountUseCase';
import { GetAccountUseCase } from '../../../domain/ports/in/GetAccountUseCase';
import { DepositFundsUseCase } from '../../../domain/ports/in/DepositFundsUseCase';

export class AccountController {
  constructor(
    private readonly createAccountUseCase: CreateAccountUseCase,
    private readonly getAccountUseCase: GetAccountUseCase,
    private readonly depositFundsUseCase: DepositFundsUseCase
  ) {}

  public createAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validatedBody = CreateAccountSchema.parse(req.body);
      const account = await this.createAccountUseCase.execute({
        userId: validatedBody.userId,
        currency: validatedBody.currency,
        name: validatedBody.name,
        email: validatedBody.email,
        initialBalance: validatedBody.initialBalance,
      });

      res.status(201).json(toAccountResponseDto(account));
    } catch (error) {
      next(error);
    }
  };

  public getAccountById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const account = await this.getAccountUseCase.getById(id);
      res.status(200).json(toAccountResponseDto(account));
    } catch (error) {
      next(error);
    }
  };

  public getAccountsByUserId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { currency } = req.query;

      if (currency && typeof currency === 'string') {
        const account = await this.getAccountUseCase.getByUserIdAndCurrency(userId, currency);
        if (!account) {
          res.status(404).json({
            error: 'AccountNotFound',
            message: `No account found for user ${userId} and currency ${currency.toUpperCase()}`,
            timestamp: new Date().toISOString(),
          });
          return;
        }
        res.status(200).json(toAccountResponseDto(account));
        return;
      }

      const accounts = await this.getAccountUseCase.getByUserId(userId);
      res.status(200).json(accounts.map((acc) => toAccountResponseDto(acc)));
    } catch (error) {
      next(error);
    }
  };

  public depositFunds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const validatedBody = DepositFundsSchema.parse(req.body);

      const result = await this.depositFundsUseCase.execute({
        accountId: id,
        amount: validatedBody.amount,
        idempotencyKey: validatedBody.idempotencyKey,
        reference: validatedBody.reference,
        name: validatedBody.name,
        email: validatedBody.email,
      });

      res.status(200).json({
        message: result.duplicate
          ? 'Idempotent request: transaction previously processed'
          : 'Funds deposited successfully',
        duplicate: result.duplicate,
        idempotencyKey: result.idempotencyKey,
        reference: result.reference,
        account: toAccountResponseDto(result.account),
      });
    } catch (error) {
      next(error);
    }
  };
}
