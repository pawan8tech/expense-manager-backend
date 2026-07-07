import asyncHandler from "express-async-handler";
import Debt from "../models/debtModel.js";
import Account from "../models/accountModel.js";
import Transaction from "../models/transactionModel.js";
import { computeAccountBalances } from "../utils/accountBalances.js";

// Advance a date by one interval of the given frequency.
const stepNext = (date, freq) => {
  const d = new Date(date);
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d;
};

// Interest accrued for one payment period on the current outstanding.
const periodInterest = (outstanding, annualRate, freq) => {
  const r = (annualRate || 0) / 100;
  if (!(outstanding > 0) || !(r > 0)) return 0;
  if (freq === "yearly") return outstanding * r;
  if (freq === "weekly") return (outstanding * r * 7) / 365;
  if (freq === "daily") return (outstanding * r) / 365;
  return (outstanding * r) / 12; // monthly
};

// Look up a single debt's outstanding from its linked loan account.
const outstandingFor = async (userId, accountId) => {
  const { accounts } = await computeAccountBalances(userId);
  const acc = accounts.find((a) => String(a._id) === String(accountId));
  return acc ? acc.outstanding : 0;
};

// GET /api/debts — debts enriched with outstanding + progress from their account.
export const listDebts = asyncHandler(async (req, res) => {
  const [debts, { accounts, totals }] = await Promise.all([
    Debt.find({ userId: req.user.id }).sort({ status: 1, createdAt: -1 }),
    computeAccountBalances(req.user.id),
  ]);
  const accMap = {};
  for (const a of accounts) accMap[String(a._id)] = a;

  const data = debts.map((d) => {
    const acc = accMap[String(d.accountId)];
    const outstanding = acc ? acc.outstanding : 0;
    const paid = Math.max((d.principal || 0) - outstanding, 0);
    const progress = d.principal > 0 ? Math.min((paid / d.principal) * 100, 100) : 0;
    return {
      _id: d._id,
      name: d.name,
      lender: d.lender,
      accountId: d.accountId,
      principal: d.principal,
      interestRate: d.interestRate,
      emiAmount: d.emiAmount,
      tenureMonths: d.tenureMonths,
      frequency: d.frequency,
      startDate: d.startDate,
      nextDueDate: d.nextDueDate,
      lastPaidDate: d.lastPaidDate,
      status: d.status,
      outstanding,
      paidPrincipal: paid,
      progress,
    };
  });

  res.status(200).json({
    success: true,
    data,
    totals: { loanOutstanding: totals.loanOutstanding || 0 },
  });
});

// POST /api/debts
export const createDebt = asyncHandler(async (req, res) => {
  const {
    name,
    lender,
    principal,
    outstanding, // for a loan already in progress — the amount still owed
    interestRate,
    emiAmount,
    tenureMonths,
    frequency = "monthly",
    startDate,
    disburseToAccountId,
    color,
  } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: "Loan name is required" });
  }
  if (!(Number(principal) > 0)) {
    return res.status(400).json({ success: false, message: "Principal must be a positive number" });
  }

  const principalNum = Number(principal);

  // An already-running loan: user provides the current outstanding. We don't
  // disburse anything now (that happened in the past); the loan simply opens at
  // the remaining balance, so progress = (principal − outstanding) shows the
  // EMIs already paid.
  const hasOutstanding =
    outstanding !== undefined && outstanding !== null && outstanding !== "";
  const outstandingNum = hasOutstanding ? Number(outstanding) : null;
  if (hasOutstanding && (!(outstandingNum >= 0) || outstandingNum > principalNum)) {
    return res.status(400).json({
      success: false,
      message: "Outstanding must be between 0 and the principal",
    });
  }

  const disburse =
    !hasOutstanding && disburseToAccountId
      ? await Account.findOne({ _id: disburseToAccountId, userId: req.user.id })
      : null;
  if (!hasOutstanding && disburseToAccountId && !disburse) {
    return res.status(404).json({ success: false, message: "Deposit account not found" });
  }

  // The loan liability account. Existing loan → opens at the remaining balance.
  // New loan disbursed to an account → opens at 0 with a disbursement transfer.
  // New loan not deposited → opens owing the full principal.
  const openingBalance = hasOutstanding
    ? -outstandingNum
    : disburse
      ? 0
      : -principalNum;

  const loanAccount = await Account.create({
    userId: req.user.id,
    name: String(name).trim(),
    type: "loan",
    openingBalance,
    color: color || "#f97316",
    icon: "Landmark",
  });

  if (disburse) {
    await Transaction.create({
      userId: req.user.id,
      name: `${String(name).trim()} disbursed`,
      type: "transfer",
      amount: principalNum,
      category: "Loan Disbursement",
      date: startDate || Date.now(),
      accountId: loanAccount._id, // from the loan (goes more negative = owed)
      toAccountId: disburse._id, // into the asset account
    });
  }

  const debt = await Debt.create({
    userId: req.user.id,
    name: String(name).trim(),
    lender: lender || "",
    accountId: loanAccount._id,
    principal: principalNum,
    interestRate: Number(interestRate) || 0,
    emiAmount: Number(emiAmount) || 0,
    tenureMonths: Number(tenureMonths) || 0,
    frequency,
    startDate: startDate || Date.now(),
    nextDueDate: startDate || Date.now(),
  });

  res.status(201).json({ success: true, data: debt });
});

// Suggested interest/principal split for the next EMI (GET helper for the UI).
export const getEmiSplit = asyncHandler(async (req, res) => {
  const debt = await Debt.findOne({ _id: req.params.id, userId: req.user.id });
  if (!debt) return res.status(404).json({ success: false, message: "Debt not found" });
  const outstanding = await outstandingFor(req.user.id, debt.accountId);
  const interest = Math.round(periodInterest(outstanding, debt.interestRate, debt.frequency));
  const emi = debt.emiAmount || 0;
  const principal = Math.max(Math.min((emi || outstanding) - interest, outstanding), 0);
  res.status(200).json({
    success: true,
    data: { outstanding, interest, principal, suggestedEmi: emi },
  });
});

// POST /api/debts/:id/pay — record an EMI as a SINGLE expense (interest +
// principal combined), and reduce the loan's outstanding by the principal
// portion. Since loans are excluded from net worth, there's no need to split
// the principal into a separate transfer — the whole EMI is simply a monthly
// expense, which is how people budget it.
export const payEmi = asyncHandler(async (req, res) => {
  const debt = await Debt.findOne({ _id: req.params.id, userId: req.user.id });
  if (!debt) return res.status(404).json({ success: false, message: "Debt not found" });

  const { accountId, amount, interest, date } = req.body;
  const payFrom = await Account.findOne({ _id: accountId, userId: req.user.id });
  if (!payFrom) return res.status(404).json({ success: false, message: "Payment account not found" });

  const outstanding = await outstandingFor(req.user.id, debt.accountId);
  if (!(outstanding > 0)) {
    return res.status(400).json({ success: false, message: "This loan is already fully paid." });
  }

  const total = Number(amount);
  if (!(total > 0)) {
    return res.status(400).json({ success: false, message: "EMI amount must be a positive number" });
  }

  // Interest defaults to the accrued amount but can be overridden by the client.
  let interestPart =
    interest !== undefined && interest !== null && interest !== ""
      ? Number(interest)
      : Math.round(periodInterest(outstanding, debt.interestRate, debt.frequency));
  interestPart = Math.max(Math.min(interestPart, total), 0);

  // Principal can't exceed what's still owed.
  let principalPart = Math.min(total - interestPart, outstanding);
  if (principalPart < 0) principalPart = 0;

  const when = date || Date.now();
  const paid = interestPart + principalPart;

  // One expense for the whole EMI.
  if (paid > 0) {
    await Transaction.create({
      userId: req.user.id,
      name: `${debt.name} EMI`,
      type: "expense",
      amount: paid,
      category: "Loan EMI",
      date: when,
      accountId: payFrom._id,
      debtId: debt._id,
    });
  }

  // Reduce the loan's outstanding by the principal portion — done by nudging the
  // loan account's opening balance toward zero (no separate transfer row).
  if (principalPart > 0) {
    const loanAccount = await Account.findOne({ _id: debt.accountId, userId: req.user.id });
    if (loanAccount) {
      loanAccount.openingBalance = (loanAccount.openingBalance || 0) + principalPart;
      await loanAccount.save();
    }
  }

  debt.lastPaidDate = when;
  debt.nextDueDate = stepNext(debt.nextDueDate || when, debt.frequency);

  const remaining = await outstandingFor(req.user.id, debt.accountId);
  if (remaining <= 0) debt.status = "closed";
  await debt.save();

  res.status(200).json({
    success: true,
    data: { debt, applied: { interest: interestPart, principal: principalPart, remaining } },
  });
});

// PUT /api/debts/:id
export const updateDebt = asyncHandler(async (req, res) => {
  const debt = await Debt.findOne({ _id: req.params.id, userId: req.user.id });
  if (!debt) return res.status(404).json({ success: false, message: "Debt not found" });

  const { name, lender, interestRate, emiAmount, nextDueDate, frequency, status } = req.body;
  if (name !== undefined) debt.name = String(name).trim();
  if (lender !== undefined) debt.lender = lender;
  if (interestRate !== undefined) debt.interestRate = Number(interestRate) || 0;
  if (emiAmount !== undefined) debt.emiAmount = Number(emiAmount) || 0;
  if (nextDueDate !== undefined) debt.nextDueDate = nextDueDate;
  if (frequency !== undefined) debt.frequency = frequency;
  if (status !== undefined) debt.status = status;
  await debt.save();

  // Keep the underlying loan account name in sync.
  if (name !== undefined) {
    await Account.updateOne({ _id: debt.accountId, userId: req.user.id }, { $set: { name: debt.name } });
  }

  res.status(200).json({ success: true, data: debt });
});

// DELETE /api/debts/:id — removes the debt, its loan account, and all linked
// transactions (disbursement, interest, principal repayments).
export const deleteDebt = asyncHandler(async (req, res) => {
  const debt = await Debt.findOne({ _id: req.params.id, userId: req.user.id });
  if (!debt) return res.status(404).json({ success: false, message: "Debt not found" });

  await Transaction.deleteMany({
    userId: req.user.id,
    $or: [{ debtId: debt._id }, { accountId: debt.accountId }, { toAccountId: debt.accountId }],
  });
  await Account.deleteOne({ _id: debt.accountId, userId: req.user.id });
  await debt.deleteOne();

  res.status(200).json({ success: true, message: "Debt deleted" });
});
