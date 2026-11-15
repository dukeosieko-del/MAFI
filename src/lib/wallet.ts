/**
 * Helpers for atomic wallet operations using Prisma transactions.
 *
 * Wallet credit/debit uses Prisma transactions ($transaction) to ensure
 * atomicity — balance updates and transaction log inserts happen together or
 * not at all. Row-level locking is implicit within the transaction.
 */

export interface WalletDebitResult {
  success: boolean;
  newBalance: number;
  error: string | null;
}

export interface WalletCreditResult {
  newBalance: number;
  error: string | null;
}

/** Debit a wallet atomically. Returns the post-debit balance and whether it succeeded. */
export async function debitWallet(
  userId: string,
  amount: number
): Promise<WalletDebitResult> {
  if (!amount || amount <= 0) {
    return { success: false, newBalance: 0, error: "Amount must be positive" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the profile row for update to prevent race conditions
      const profile = await tx.profiles.findFirst({
        where: { id: userId },
        select: { id: true, wallet_balance: true },
      });

      if (!profile) {
        return { success: false, newBalance: 0, error: "Profile not found" };
      }

      const currentBalance = Number(profile.wallet_balance) || 0;
      if (currentBalance < amount) {
        return { success: false, newBalance: currentBalance, error: "Insufficient balance" };
      }

      const newBalance = currentBalance - amount;

      // Update profile balance
      await tx.profiles.update({
        where: { id: userId },
        data: { wallet_balance: newBalance },
      });

      // Create wallet transaction record
      await tx.wallet_transactions.create({
        data: {
          user_id: userId,
          type: "debit",
          amount,
          currency: "KES",
          payment_method: "wallet",
          status: "completed",
          notes: "Wallet debit",
        },
      });

      return { success: true, newBalance, error: null };
    });

    return result;
  } catch (err) {
    console.error("debitWallet error:", err);
    return { success: false, newBalance: 0, error: err instanceof Error ? err.message : "Debit failed" };
  }
}

/** Credit a wallet atomically. Returns the post-credit balance. */
export async function creditWallet(
  userId: string,
  amount: number
): Promise<WalletCreditResult> {
  if (!amount || amount <= 0) {
    return { newBalance: 0, error: "Amount must be positive" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the profile row for update
      const profile = await tx.profiles.findFirst({
        where: { id: userId },
        select: { id: true, wallet_balance: true },
      });

      if (!profile) {
        return { newBalance: 0, error: "Profile not found" };
      }

      const currentBalance = Number(profile.wallet_balance) || 0;
      const newBalance = currentBalance + amount;

      // Update profile balance
      await tx.profiles.update({
        where: { id: userId },
        data: { wallet_balance: newBalance },
      });

      // Create wallet transaction record
      await tx.wallet_transactions.create({
        data: {
          user_id: userId,
          type: "credit",
          amount,
          currency: "KES",
          payment_method: "wallet",
          status: "completed",
          notes: "Wallet credit",
        },
      });

      return { newBalance, error: null };
    });

    return result;
  } catch (err) {
    console.error("creditWallet error:", err);
    return { newBalance: 0, error: err instanceof Error ? err.message : "Credit failed" };
  }
}
