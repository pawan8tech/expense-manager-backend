import mongoose from "mongoose";
import Account from "../models/accountModel.js";
import Transaction from "../models/transactionModel.js";

/**
 * Compute every account's balance for a user from opening balance + the signed
 * effect of its transactions. This is the single source of truth for balances
 * — nothing stores a running total.
 *
 * Signed effect per account:
 *   income   → +amount        expense → −amount        saving → −amount
 *   transfer → −amount on the source (accountId), +amount on dest (toAccountId)
 *
 * For a credit card (liability) the raw balance is normally negative; we expose
 * `outstanding` (= amount owed) and `availableCredit` for display.
 *
 * Returns { accounts, totals } where totals has liquid assets, card debt, and
 * the net contribution to net worth.
 */
export const computeAccountBalances = async (userId, { includeArchived = true } = {}) => {
  const oid = new mongoose.Types.ObjectId(userId);
  const accountFilter = { userId: oid };
  if (!includeArchived) accountFilter.isArchived = false;

  const [accounts, regular, transfersOut, transfersIn] = await Promise.all([
    Account.find(accountFilter).sort({ isArchived: 1, createdAt: 1 }),
    Transaction.aggregate([
      {
        $match: {
          userId: oid,
          accountId: { $ne: null },
          type: { $in: ["income", "expense", "saving"] },
        },
      },
      { $group: { _id: { acc: "$accountId", type: "$type" }, total: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate([
      { $match: { userId: oid, type: "transfer", accountId: { $ne: null } } },
      { $group: { _id: "$accountId", total: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate([
      { $match: { userId: oid, type: "transfer", toAccountId: { $ne: null } } },
      { $group: { _id: "$toAccountId", total: { $sum: "$amount" } } },
    ]),
  ]);

  // Accumulate the signed delta per account.
  const delta = {};
  for (const r of regular) {
    const acc = String(r._id.acc);
    const sign = r._id.type === "income" ? 1 : -1;
    delta[acc] = (delta[acc] || 0) + sign * r.total;
  }
  for (const t of transfersOut) {
    const acc = String(t._id);
    delta[acc] = (delta[acc] || 0) - t.total;
  }
  for (const t of transfersIn) {
    const acc = String(t._id);
    delta[acc] = (delta[acc] || 0) + t.total;
  }

  let totalAssets = 0;
  let cardOwed = 0;
  let loanOwed = 0;
  let netContribution = 0;

  const enriched = accounts.map((a) => {
    const raw = (a.openingBalance || 0) + (delta[String(a._id)] || 0);
    const isLiability = a.type === "credit_card" || a.type === "loan";
    const outstanding = isLiability ? Math.max(-raw, 0) : 0;

    if (!a.isArchived) {
      netContribution += raw;
      if (a.type === "credit_card") cardOwed += outstanding;
      else if (a.type === "loan") loanOwed += outstanding;
      else totalAssets += raw;
    }

    return {
      _id: a._id,
      name: a.name,
      type: a.type,
      openingBalance: a.openingBalance || 0,
      creditLimit: a.creditLimit || 0,
      color: a.color,
      icon: a.icon,
      isDefault: a.isDefault,
      isArchived: a.isArchived,
      isLiability,
      balance: raw,
      outstanding,
      availableCredit: a.type === "credit_card" ? (a.creditLimit || 0) - outstanding : null,
    };
  });

  return {
    accounts: enriched,
    totals: {
      liquidAssets: totalAssets, // spendable money across cash/bank/wallet
      cardOutstanding: cardOwed, // total owed on credit cards
      loanOutstanding: loanOwed, // total owed on loans
      netContribution, // assets − all liabilities (cards + loans)
      // Net worth contribution EXCLUDING loans: loans are offset by a physical
      // asset the app doesn't track, so counting them makes net worth look
      // permanently negative. Credit-card debt still counts (real spend).
      netExclLoans: totalAssets - cardOwed,
    },
  };
};
