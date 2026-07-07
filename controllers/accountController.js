import asyncHandler from "express-async-handler";
import Account from "../models/accountModel.js";
import Transaction from "../models/transactionModel.js";
import SavingsGoal from "../models/savingGoalModel.js";
import { computeAccountBalances } from "../utils/accountBalances.js";

const ACCOUNT_TYPES = ["cash", "bank", "wallet", "credit_card"];

/**
 * Ensure a user has at least a default account. Seeds a "Bank" (default) + a
 * "Cash" account on first use. Idempotent.
 *
 * Returns the user's default account.
 */
export const ensureUserAccounts = async (userId) => {
  let accounts = await Account.find({ userId });

  if (accounts.length === 0) {
    await Account.create([
      { userId, name: "Bank", type: "bank", isDefault: true, icon: "Landmark", color: "#6366f1" },
      { userId, name: "Cash", type: "cash", isDefault: false, icon: "Wallet", color: "#10b981" },
    ]);
    accounts = await Account.find({ userId });
  }

  return accounts.find((a) => a.isDefault) || accounts[0];
};

const countAccountUsage = async (userId, accountId) => {
  const [from, to] = await Promise.all([
    Transaction.countDocuments({ userId, accountId }),
    Transaction.countDocuments({ userId, toAccountId: accountId }),
  ]);
  return { asSource: from, asDestination: to, total: from + to };
};

const validDay = (d) => Number.isInteger(Number(d)) && Number(d) >= 1 && Number(d) <= 31;

const validateAccountPayload = (fields, { requireAll = false } = {}) => {
  const { name, type, openingBalance, creditLimit, statementDay, dueDay } = fields;
  if (requireAll) {
    if (!name || !String(name).trim()) return "Name is required";
    if (!type) return "Type is required";
  }
  if (type !== undefined && !ACCOUNT_TYPES.includes(type)) return "Invalid account type";
  if (openingBalance !== undefined && !Number.isFinite(Number(openingBalance)))
    return "Opening balance must be a number";
  if (creditLimit !== undefined && (!Number.isFinite(Number(creditLimit)) || Number(creditLimit) < 0))
    return "Credit limit must be a non-negative number";
  if (statementDay !== undefined && statementDay !== null && statementDay !== "" && !validDay(statementDay))
    return "Bill generation day must be between 1 and 31";
  if (dueDay !== undefined && dueDay !== null && dueDay !== "" && !validDay(dueDay))
    return "Bill payment day must be between 1 and 31";
  return null;
};

const ACCOUNT_EDITABLE = [
  "name", "type", "openingBalance", "creditLimit", "color", "icon", "isDefault",
  "statementDay", "dueDay",
];
const pickAccountFields = (body = {}) => {
  const out = {};
  for (const key of ACCOUNT_EDITABLE) if (body[key] !== undefined) out[key] = body[key];
  return out;
};

// GET /api/accounts — accounts with computed balances + totals.
export const listAccounts = asyncHandler(async (req, res) => {
  await ensureUserAccounts(req.user.id);
  const { accounts, totals } = await computeAccountBalances(req.user.id);

  // "Reserved" = money earmarked by active savings goals kept in each account.
  // available = balance − reserved (what's actually free to spend).
  const goals = await SavingsGoal.find({
    userId: req.user.id,
    type: "goal",
    status: "active",
    heldInAccountId: { $ne: null },
  });
  const reservedMap = {};
  for (const g of goals) {
    const k = String(g.heldInAccountId);
    reservedMap[k] = (reservedMap[k] || 0) + (g.savedAmount || 0);
  }

  const data = accounts.map((a) => {
    const reserved = reservedMap[String(a._id)] || 0;
    return { ...a, reserved, available: a.balance - reserved };
  });

  res.status(200).json({ success: true, data, totals });
});

// POST /api/accounts
export const createAccount = asyncHandler(async (req, res) => {
  const fields = pickAccountFields(req.body);
  const error = validateAccountPayload(fields, { requireAll: true });
  if (error) return res.status(400).json({ success: false, message: error });

  // First account becomes the default automatically.
  const existingCount = await Account.countDocuments({ userId: req.user.id });
  if (existingCount === 0) fields.isDefault = true;

  // Only one default at a time.
  if (fields.isDefault) {
    await Account.updateMany({ userId: req.user.id }, { $set: { isDefault: false } });
  }

  const account = await Account.create({ ...fields, userId: req.user.id });
  res.status(201).json({ success: true, data: account });
});

// PUT /api/accounts/:id
export const updateAccount = asyncHandler(async (req, res) => {
  const fields = pickAccountFields(req.body);
  const error = validateAccountPayload(fields);
  if (error) return res.status(400).json({ success: false, message: error });

  if (fields.isDefault) {
    await Account.updateMany({ userId: req.user.id }, { $set: { isDefault: false } });
  }

  const account = await Account.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: fields },
    { new: true, runValidators: true }
  );
  if (!account) return res.status(404).json({ success: false, message: "Account not found" });
  res.status(200).json({ success: true, data: account });
});

// GET /api/accounts/:id/transactions — recent transactions that touched this
// account (as source or transfer destination), newest first.
export const getAccountTransactions = asyncHandler(async (req, res) => {
  const account = await Account.findOne({ _id: req.params.id, userId: req.user.id });
  if (!account) return res.status(404).json({ success: false, message: "Account not found" });

  const transactions = await Transaction.find({
    userId: req.user.id,
    isPlanned: { $ne: true },
    $or: [{ accountId: account._id }, { toAccountId: account._id }],
  })
    .sort({ date: -1 })
    .limit(100);

  res.status(200).json({ success: true, data: transactions });
});

// GET /api/accounts/:id/usage — how many transactions reference this account.
export const getAccountUsage = asyncHandler(async (req, res) => {
  const account = await Account.findOne({ _id: req.params.id, userId: req.user.id });
  if (!account) return res.status(404).json({ success: false, message: "Account not found" });
  const usage = await countAccountUsage(req.user.id, account._id);
  res.status(200).json({ success: true, data: { id: account._id, name: account.name, ...usage } });
});

/**
 * DELETE /api/accounts/:id
 * If the account is referenced by transactions, the delete is refused (409)
 * unless `?force=true`. `?reassignTo=<id>` moves its transactions to another
 * account first. Archiving (PUT isArchived) is the non-destructive alternative.
 */
export const deleteAccount = asyncHandler(async (req, res) => {
  const account = await Account.findOne({ _id: req.params.id, userId: req.user.id });
  if (!account) return res.status(404).json({ success: false, message: "Account not found" });

  const total = await Account.countDocuments({ userId: req.user.id });
  if (total <= 1) {
    return res.status(400).json({ success: false, message: "You must keep at least one account." });
  }

  const { reassignTo } = req.query;
  const force = req.query.force === "true";
  const usage = await countAccountUsage(req.user.id, account._id);

  if (usage.total > 0) {
    if (reassignTo) {
      const target = await Account.findOne({ _id: reassignTo, userId: req.user.id });
      if (!target) return res.status(404).json({ success: false, message: "Target account not found" });
      if (String(target._id) === String(account._id))
        return res.status(400).json({ success: false, message: "Pick a different account to move to." });
      await Promise.all([
        Transaction.updateMany({ userId: req.user.id, accountId: account._id }, { $set: { accountId: target._id } }),
        Transaction.updateMany({ userId: req.user.id, toAccountId: account._id }, { $set: { toAccountId: target._id } }),
      ]);
    } else if (!force) {
      return res.status(409).json({
        success: false,
        message: `'${account.name}' has ${usage.total} transaction(s). Move them to another account or confirm to delete anyway.`,
        data: { id: account._id, name: account.name, inUse: usage.total },
      });
    }
  }

  const wasDefault = account.isDefault;
  await account.deleteOne();

  // Ensure a default still exists.
  if (wasDefault) {
    const next = await Account.findOne({ userId: req.user.id }).sort({ createdAt: 1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }

  res.status(200).json({ success: true, message: "Account deleted" });
});
