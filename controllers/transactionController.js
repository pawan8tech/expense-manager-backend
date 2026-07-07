// src/controllers/transactionController.js
import asyncHandler from "express-async-handler";
import Transaction from "../models/transactionModel.js";
import Account from "../models/accountModel.js";
import { generateDueTransactions } from "./recurringController.js";
import { generateDueBills, generateCardBills } from "./billController.js";
import { ensureUserAccounts } from "./accountController.js";
import { computeAccountBalances } from "../utils/accountBalances.js";
import mongoose from "mongoose";

// Fields the client is allowed to write. Anything else in req.body (userId,
// _id, archived, recurringId, etc.) is dropped so a malicious payload can't
// cross-write into another user's account or flip server-managed flags.
const TX_EDITABLE_FIELDS = ["name", "type", "amount", "category", "note", "date", "accountId", "toAccountId"];
const pickTxFields = (body = {}) => {
  const out = {};
  for (const key of TX_EDITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

const TX_TYPES = ["income", "expense", "saving"];

// Validate a transaction payload. Returns an error string, or null when valid.
// `requireAll` enforces presence of the core fields (for create); otherwise it
// only validates the fields that are present (for partial updates).
const validateTxPayload = (fields, { requireAll = false } = {}) => {
  const { name, type, amount, category } = fields;

  if (requireAll) {
    if (!name || !String(name).trim()) return "Name is required";
    if (type === undefined) return "Type is required";
    if (amount === undefined || amount === null || amount === "") return "Amount is required";
    if (!category || !String(category).trim()) return "Category is required";
  }

  if (type !== undefined && !TX_TYPES.includes(type)) return "Invalid transaction type";
  if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
    return "Amount must be a positive number";
  }
  if (name !== undefined && !String(name).trim()) return "Name cannot be empty";
  if (category !== undefined && !String(category).trim()) return "Category cannot be empty";
  return null;
};

/**
 * Guard: a credit-card expense can't push the card's outstanding past its limit.
 * Returns an error string when the spend would exceed available credit, else
 * null. Cards with no limit set (creditLimit <= 0) are treated as "no cap".
 * `excludeAmount` lets edits ignore the transaction's own current amount, which
 * is already baked into the outstanding balance.
 */
const checkCreditLimit = async (userId, accountId, amount, excludeAmount = 0) => {
  const account = await Account.findOne({ _id: accountId, userId });
  if (!account || account.type !== "credit_card") return null;
  if (!(account.creditLimit > 0)) return null;

  const { accounts } = await computeAccountBalances(userId);
  const acc = accounts.find((a) => String(a._id) === String(accountId));
  const outstanding = acc ? acc.outstanding : 0;
  const projected = outstanding - excludeAmount + Number(amount);
  if (projected > account.creditLimit) {
    const available = Math.max(account.creditLimit - (outstanding - excludeAmount), 0);
    return `Amount exceeds the available credit on ${account.name} (available: ${available}).`;
  }
  return null;
};

export const getTransactions = asyncHandler(async (req, res) => {
  await generateDueTransactions(req.user.id);
  await generateDueBills(req.user.id);
  // Seed default accounts on first use so the computed balance is correct
  // regardless of which page the user opens first.
  await ensureUserAccounts(req.user.id);
  await generateCardBills(req.user.id);

  // Pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const { startDate, endDate, type, category, search, sortBy, sortOrder } = req.query;

  // Sorting — whitelist the sortable fields so a bad query param can't sort on
  // an arbitrary/indexed-heavy field. Default is newest-first by date.
  const SORT_FIELDS = { date: "date", amount: "amount", name: "name" };
  const sortField = SORT_FIELDS[sortBy] || "date";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  // Secondary date tiebreaker keeps ordering stable when amounts/names collide.
  const sortSpec = sortField === "date" ? { date: sortDir } : { [sortField]: sortDir, date: -1 };
  // Make the range end inclusive of the WHOLE end day. `new Date("YYYY-MM-DD")`
  // is midnight UTC, so a plain `$lte` drops any transaction on the end date
  // that carries a real timestamp (e.g. today's, created with `new Date()`) —
  // which made today's transactions vanish on refresh.
  const endDateInclusive = endDate ? new Date(endDate) : null;
  if (endDateInclusive) endDateInclusive.setHours(23, 59, 59, 999);

  // Event-linked transactions are fully isolated: they live only on the event
  // page and are excluded from this list, the counts, and every total here.
  // (`eventId: null` also matches ordinary transactions that predate the field.)
  // Lending movements DO appear in the list (as neutral transfer rows), and
  // being type "transfer" they never count toward income/expense totals.
  const filter = { userId: req.user.id, isPlanned: { $ne: true }, eventId: null };

  // Type filter (income/expense)
  if (type && type !== 'all') {
    filter.type = type;
  }

  // Category filter
  if (category) {
    filter.category = category;
  }

  // Date range filter
  if (startDate && endDate) {
    filter.date = { $gte: new Date(startDate), $lte: endDateInclusive };
  }

  // Search filter (search in name)
  if (search && search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { category: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  // Get total count for pagination
  const totalCount = await Transaction.countDocuments(filter);
  const totalPages = Math.ceil(totalCount / limit);

  // Get paginated transactions
  const transactions = await Transaction.find(filter)
    .sort(sortSpec)
    .skip(skip)
    .limit(limit);

  // Get counts by type for the current filter (excluding type filter)
  const countFilter = { userId: req.user.id, isPlanned: { $ne: true }, eventId: null };
  if (startDate && endDate) {
    countFilter.date = { $gte: new Date(startDate), $lte: endDateInclusive };
  }
  if (search && search.trim()) {
    countFilter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { category: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  const allCount = await Transaction.countDocuments(countFilter);
  const incomeCount = await Transaction.countDocuments({ ...countFilter, type: 'income' });
  const expenseCount = await Transaction.countDocuments({ ...countFilter, type: 'expense' });
  const savingCount = await Transaction.countDocuments({ ...countFilter, type: 'saving' });

  // ---------- Summary Calculations ----------
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const now = new Date();
  
  // Helper function to calculate percentage change
  const calcPercentChange = (current, previous) => {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 100);
  };

  // Determine the current period and previous period based on filter
  let currentPeriodStart, currentPeriodEnd, prevPeriodStart, prevPeriodEnd;
  let periodLabel = 'this month';
  let comparisonLabel = 'vs last month';

  if (startDate && endDate) {
    // Use the filter dates as current period (end inclusive of the whole day).
    currentPeriodStart = new Date(startDate);
    currentPeriodEnd = endDateInclusive;

    // Calculate the duration of the period
    const periodDuration = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
    
    // Previous period is the same duration before the current period
    prevPeriodEnd = new Date(currentPeriodStart.getTime() - 1); // Day before current start
    prevPeriodStart = new Date(prevPeriodEnd.getTime() - periodDuration);
    
    // Set labels based on filter type
    const daysDiff = Math.ceil(periodDuration / (1000 * 60 * 60 * 24));
    if (daysDiff <= 31) {
      periodLabel = 'selected period';
      comparisonLabel = 'vs previous period';
    } else if (daysDiff <= 93) {
      periodLabel = 'selected period';
      comparisonLabel = 'vs previous period';
    } else {
      periodLabel = 'selected period';
      comparisonLabel = 'vs previous period';
    }
  } else {
    // Default to current month
    currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Previous month
    prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevPeriodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    
    periodLabel = 'this month';
    comparisonLabel = 'vs last month';
  }

  // Current period aggregation
  const currentPeriodFilter = {
    userId,
    isPlanned: { $ne: true },
    eventId: null,
    date: { $gte: currentPeriodStart, $lte: currentPeriodEnd },
  };

  const currentPeriodAggregation = await Transaction.aggregate([
    { $match: currentPeriodFilter },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" }
      }
    }
  ]);

  const currentIncome = currentPeriodAggregation.find(a => a._id === 'income')?.total || 0;
  const currentExpense = currentPeriodAggregation.find(a => a._id === 'expense')?.total || 0;
  // Actual amount the user moved to savings in this period (type: 'saving')
  const currentSavings = currentPeriodAggregation.find(a => a._id === 'saving')?.total || 0;

  // Previous period aggregation
  const prevPeriodFilter = {
    userId,
    isPlanned: { $ne: true },
    eventId: null,
    date: { $gte: prevPeriodStart, $lte: prevPeriodEnd },
  };

  const prevPeriodAggregation = await Transaction.aggregate([
    { $match: prevPeriodFilter },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" }
      }
    }
  ]);

  const prevIncome = prevPeriodAggregation.find(a => a._id === 'income')?.total || 0;
  const prevExpense = prevPeriodAggregation.find(a => a._id === 'expense')?.total || 0;
  const prevSavings = prevPeriodAggregation.find(a => a._id === 'saving')?.total || 0;

  // Current balance = spendable money across cash/bank/wallet accounts. Computed
  // from account balances (not income − expense − saving) so credit-card spends
  // and transfers don't wrongly move it. With a single migrated account this
  // equals the old formula; with cards it stays correct.
  const { totals } = await computeAccountBalances(req.user.id);
  const currentBalance = totals.liquidAssets;

  // Calculate percentage changes
  const incomeChange = calcPercentChange(currentIncome, prevIncome);
  const expenseChange = calcPercentChange(currentExpense, prevExpense);
  const savingsChange = calcPercentChange(currentSavings, prevSavings);

  // Balance change = net cashflow this period vs net cashflow last period.
  const currentNet = currentIncome - currentExpense - currentSavings;
  const prevNet = prevIncome - prevExpense - prevSavings;
  const balanceChange = calcPercentChange(currentNet, prevNet);

  res.status(200).json({
    success: true,
    data: transactions,
    pagination: {
      currentPage: page,
      totalPages,
      totalCount,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    },
    counts: {
      all: allCount,
      income: incomeCount,
      expense: expenseCount,
      saving: savingCount
    },
    summary: {
      currentBalance,
      totalIncome: currentIncome,
      totalExpense: currentExpense,
      savings: currentSavings,
      periodLabel,
      comparisonLabel,
      changes: {
        income: incomeChange,
        expense: expenseChange,
        savings: savingsChange,
        balance: balanceChange
      },
      previous: {
        income: prevIncome,
        expense: prevExpense,
        savings: prevSavings
      }
    },
  });
})

  
// Add Transaction
export const addTransaction = asyncHandler(async (req, res) => {
  const fields = pickTxFields(req.body);
  const error = validateTxPayload(fields, { requireAll: true });
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }
  // Transfers have their own endpoint; this path is income/expense/saving only.
  delete fields.toAccountId;
  // Every transaction belongs to an account. If the client didn't pick one,
  // fall back to the user's default account (also seeds accounts on first use).
  if (!fields.accountId) {
    const def = await ensureUserAccounts(req.user.id);
    fields.accountId = def?._id || null;
  }
  if (fields.type === "expense" && fields.accountId) {
    const limitError = await checkCreditLimit(req.user.id, fields.accountId, fields.amount);
    if (limitError) return res.status(400).json({ success: false, message: limitError });
  }
  const transaction = new Transaction({ ...fields, userId: req.user.id });
  await transaction.save();
  res.status(201).json({ success: true, data: transaction });
});

/**
 * POST /api/transactions/transfer
 * Move money between two of the user's own accounts. A transfer is a single
 * document (type "transfer", accountId = from, toAccountId = to). It is NEVER
 * counted as income/expense — this is what makes paying a credit-card bill a
 * transfer instead of a double-counted expense.
 */
export const addTransfer = asyncHandler(async (req, res) => {
  const { fromAccountId, toAccountId, amount, date, note, name } = req.body;

  if (!fromAccountId || !toAccountId) {
    return res.status(400).json({ success: false, message: "Both accounts are required" });
  }
  if (String(fromAccountId) === String(toAccountId)) {
    return res.status(400).json({ success: false, message: "Choose two different accounts" });
  }
  if (amount === undefined || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Amount must be a positive number" });
  }

  const [from, to] = await Promise.all([
    Account.findOne({ _id: fromAccountId, userId: req.user.id }),
    Account.findOne({ _id: toAccountId, userId: req.user.id }),
  ]);
  if (!from || !to) {
    return res.status(404).json({ success: false, message: "Account not found" });
  }

  const transaction = await Transaction.create({
    userId: req.user.id,
    name: name?.trim() || `Transfer: ${from.name} → ${to.name}`,
    type: "transfer",
    amount: Number(amount),
    category: "Transfer",
    note,
    date: date || Date.now(),
    accountId: from._id,
    toAccountId: to._id,
  });

  res.status(201).json({ success: true, data: transaction });
});

// Get Single Transaction
export const getTransaction =asyncHandler( async (req, res) => {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.status(200).json({ success: true, data: transaction });
});
// Update Transaction
export const updateTransaction = asyncHandler(async (req, res) => {
  const fields = pickTxFields(req.body);
  const error = validateTxPayload(fields);
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  const existing = await Transaction.findOne({ _id: req.params.id, userId: req.user.id });
  if (!existing) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  // Credit-limit guard for the resulting state, excluding this transaction's own
  // current amount (already in the card's outstanding).
  const newType = fields.type !== undefined ? fields.type : existing.type;
  const newAccountId = fields.accountId !== undefined ? fields.accountId : existing.accountId;
  const newAmount = fields.amount !== undefined ? Number(fields.amount) : existing.amount;
  if (newType === "expense" && newAccountId) {
    const excludeAmount =
      existing.type === "expense" && String(existing.accountId) === String(newAccountId)
        ? existing.amount
        : 0;
    const limitError = await checkCreditLimit(req.user.id, newAccountId, newAmount, excludeAmount);
    if (limitError) return res.status(400).json({ success: false, message: limitError });
  }

  const transaction = await Transaction.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: fields },
    { new: true, runValidators: true }
  );
  res.status(200).json({ success: true, data: transaction });
});

// Delete Transaction
export const deleteTransaction = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOneAndDelete({
    _id: req.params.id,
    userId: req.user.id,
  });

  if (!transaction) {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  res.status(200).json({ success: true, message: "Transaction deleted" });
});
