import { z } from 'zod';

export const DepositFundsSchema = z.object({
  amount: z.number().positive('amount must be greater than zero'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required'),
  reference: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
});

export type DepositFundsDto = z.infer<typeof DepositFundsSchema>;
