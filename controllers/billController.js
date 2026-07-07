import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ScheduledPayment from "../models/scheduledPaymentModel.js";
import Transaction from "../models/transactionModel.js";
import Account from "../models/accountModel.js";
import { ensureUserAccounts } from "./accountController.js";
import { computeAccountBalances } from "../utils/accountBalances.js";

// Advance a date by one interval of the given frequency.
const stepNext = (date, freq, interval = 1) => {
  const d = new Date(date);
  const n = Math.max(1, interval || 1);
  if (freq === "daily") d.setDate(d.getDate() + n);
  else if (freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n); // monthly default
  return d;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Derived lifecycle status for display. A one-off that's paid, or a recurring
// bill that has ended (isPaid flipped on when it passes its endDate), is "paid".
const deriveStatus = (bill, t0, soon) => {
  if (bill.isPaid) return "paid";
  const due = new Date(bill.dueDate);
  if (due < t0) return "overdue";
  if (due <= soon) return "due_soon";
  return "upcoming";
};

// A recurring bill that has advanced past its end date is finished.
const isPastEnd = (bill) => bill.endDate && new Date(bill.dueDate) > new Date(bill.endDate);

/**
 * Materialize any auto-post bills whose due date has arrived. Reminder bills are
 * left untouched (the user marks those paid with the actual amount). Called on
 * dashboard/transaction loads, like recurring generation. Idempotent.
 */
export const generateDueBills = async (userId) => {
  const t0 = startOfToday();
  const bills = await ScheduledPayment.find({
    userId,
    mode: "auto_post",
    isActive: true,
    isPaid: false,
    dueDate: { $lte: t0 },
  });
  if (!bills.length) return;

  let defaultAccountId = null;
  for (const bill of bills) {
    let guard = 0;
    while (new Date(bill.dueDate) <= t0 && !bill.isPaid && guard++ < 600) {
      if (!bill.accountId && !defaultAccountId) {
        const def = await ensureUserAccounts(userId);
        defaultAccountId = def?._id || null;
      }
      await Transaction.create({
        userId,
        name: bill.name,
        type: bill.type,
        amount: bill.amount,
        category: bill.category || "Bills",
        date: bill.dueDate,
        accountId: bill.accountId || defaultAccountId,
        billId: bill._id,
        note: bill.note,
      });
      bill.lastPaidDate = bill.dueDate;
      if (bill.recurrence === "none") {
        bill.isPaid = true;
        bill.isActive = false;
        break;
      }
      bill.dueDate = stepNext(bill.dueDate, bill.recurrence, bill.interval);
      // Stop once we've passed the (optional) end date.
      if (isPastEnd(bill)) {
        bill.isPaid = true;
        bill.isActive = false;
        break;
      }
    }
    await bill.save();
  }
};

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const clampDay = (y, m, day) => Math.min(day, daysInMonth(y, m));

/**
 * Generate credit-card statement bills. On each card's statement day, if it has
 * an outstanding balance, create a one-off bill for that amount due on the next
 * due day. `lastStatementDate` guards against generating twice for a cycle.
 * Paying the bill is handled as a Bank→Card transfer in payBill.
 */
export const generateCardBills = async (userId) => {
  const cards = await Account.find({
    userId,
    type: "credit_card",
    isArchived: false,
    statementDay: { $ne: null },
  });
  if (!cards.length) return;

  const { accounts } = await computeAccountBalances(userId);
  const outMap = {};
  for (const a of accounts) outMap[String(a._id)] = a.outstanding || 0;

  const today = startOfToday();
  const y = today.getFullYear();
  const m = today.getMonth();

  for (const card of cards) {
    if (!(card.statementDay >= 1)) continue;

    // Most recent statement date on/before today.
    let stmt = new Date(y, m, clampDay(y, m, card.statementDay));
    if (stmt > today) stmt = new Date(y, m - 1, clampDay(y, m - 1, card.statementDay));

    if (card.lastStatementDate && new Date(card.lastStatementDate) >= stmt) continue;

    const outstanding = outMap[String(card._id)] || 0;
    // Mark the cycle processed regardless, so we don't re-check every load.
    card.lastStatementDate = stmt;
    await card.save();
    if (!(outstanding > 0)) continue;

    // Due date: the next dueDay on/after the statement date.
    const dueDay = card.dueDay >= 1 ? card.dueDay : card.statementDay;
    let due;
    if (dueDay > card.statementDay) {
      due = new Date(stmt.getFullYear(), stmt.getMonth(), clampDay(stmt.getFullYear(), stmt.getMonth(), dueDay));
    } else {
      const nm = (stmt.getMonth() + 1) % 12;
      const ny = stmt.getMonth() === 11 ? stmt.getFullYear() + 1 : stmt.getFullYear();
      due = new Date(ny, nm, clampDay(ny, nm, dueDay));
    }

    await ScheduledPayment.create({
      userId,
      name: `${card.name} bill`,
      type: "expense",
      category: "Credit Card Bill",
      amount: outstanding,
      dueDate: due,
      recurrence: "none",
      mode: "reminder",
      isActive: true,
      sourceCardId: card._id,
    });
  }
};

// GET /api/bills
export const listBills = asyncHandler(async (req, res) => {
  await generateDueBills(req.user.id);
  await generateCardBills(req.user.id);

  const t0 = startOfToday();
  const soon = new Date(t0);
  soon.setDate(soon.getDate() + 7);

  const bills = await ScheduledPayment.find({ userId: req.user.id }).sort({ dueDate: 1 });

  const data = bills.map((b) => ({
    _id: b._id,
    name: b.name,
    type: b.type,
    category: b.category,
    amount: b.amount,
    accountId: b.accountId,
    dueDate: b.dueDate,
    recurrence: b.recurrence,
    interval: b.interval,
    mode: b.mode,
    isActive: b.isActive,
    isPaid: b.isPaid,
    lastPaidDate: b.lastPaidDate,
    note: b.note,
    sourceCardId: b.sourceCardId,
    status: deriveStatus(b, t0, soon),
  }));

  // Summary rollups for the header cards.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const paidAgg = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.user.id),
        billId: { $ne: null },
        date: { $gte: monthStart },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  // Actual bill payments this month (covers recurring bills too, which advance
  // instead of flipping to a "paid" state). This is what the Paid list shows.
  const paidTxns = await Transaction.find({
    userId: req.user.id,
    billId: { $ne: null },
    date: { $gte: monthStart },
  })
    .sort({ date: -1 })
    .limit(50);
  const paid = paidTxns.map((t) => ({
    _id: t._id,
    name: t.name,
    amount: t.amount,
    type: t.type,
    category: t.category,
    date: t.date,
  }));

  const overdue = data.filter((b) => b.status === "overdue");
  const dueSoon = data.filter((b) => b.status === "due_soon");

  res.status(200).json({
    success: true,
    data,
    paid,
    summary: {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, b) => s + (b.amount || 0), 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((s, b) => s + (b.amount || 0), 0),
      paidThisMonth: paidAgg[0]?.total || 0,
      paidThisMonthCount: paidAgg[0]?.count || 0,
    },
  });
});

const validateBillPayload = (fields, { requireAll = false } = {}) => {
  const { name, amount, dueDate } = fields;
  if (requireAll) {
    if (!name || !String(name).trim()) return "Name is required";
    if (amount === undefined || amount === null || amount === "") return "Amount is required";
    if (!dueDate) return "Due date is required";
  }
  if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
    return "Amount must be a positive number";
  }
  return null;
};

const BILL_EDITABLE = [
  "name", "type", "category", "amount", "accountId",
  "dueDate", "recurrence", "interval", "endDate", "mode", "isActive", "note",
];
const pickBillFields = (body = {}) => {
  const out = {};
  for (const k of BILL_EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

// POST /api/bills
export const createBill = asyncHandler(async (req, res) => {
  const fields = pickBillFields(req.body);
  const error = validateBillPayload(fields, { requireAll: true });
  if (error) return res.status(400).json({ success: false, message: error });

  const bill = await ScheduledPayment.create({ ...fields, userId: req.user.id });
  res.status(201).json({ success: true, data: bill });
});

// PUT /api/bills/:id
export const updateBill = asyncHandler(async (req, res) => {
  const fields = pickBillFields(req.body);
  const error = validateBillPayload(fields);
  if (error) return res.status(400).json({ success: false, message: error });

  const bill = await ScheduledPayment.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: fields },
    { new: true, runValidators: true }
  );
  if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
  res.status(200).json({ success: true, data: bill });
});

// DELETE /api/bills/:id
export const deleteBill = asyncHandler(async (req, res) => {
  const bill = await ScheduledPayment.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
  res.status(200).json({ success: true, message: "Bill deleted" });
});

/**
 * POST /api/bills/:id/pay — mark a bill paid with the ACTUAL amount (defaults to
 * the expected amount). Creates the transaction, then advances a recurring bill
 * or closes a one-off.
 */
export const payBill = asyncHandler(async (req, res) => {
  const bill = await ScheduledPayment.findOne({ _id: req.params.id, userId: req.user.id });
  if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });

  const { amount, date, accountId } = req.body;
  const amt = amount !== undefined && amount !== null && amount !== "" ? Number(amount) : bill.amount;
  if (!(amt > 0)) {
    return res.status(400).json({ success: false, message: "Amount must be a positive number" });
  }

  const when = date || Date.now();

  if (bill.sourceCardId) {
    // Credit-card bill: paying it moves money Bank → Card (reduces outstanding).
    // It's NOT an expense — the card spends were already logged as expenses.
    if (!accountId) {
      return res.status(400).json({ success: false, message: "Choose an account to pay from" });
    }
    const payFrom = await Account.findOne({ _id: accountId, userId: req.user.id });
    if (!payFrom) return res.status(404).json({ success: false, message: "Payment account not found" });

    await Transaction.create({
      userId: req.user.id,
      name: `${bill.name} payment`,
      type: "transfer",
      amount: amt,
      category: "Credit Card Payment",
      date: when,
      accountId: payFrom._id, // money leaves the bank
      toAccountId: bill.sourceCardId, // into the card (reduces what's owed)
      billId: bill._id,
    });
  } else {
    // Regular bill → a normal expense/income.
    let payAccountId = accountId || bill.accountId;
    if (!payAccountId) {
      const def = await ensureUserAccounts(req.user.id);
      payAccountId = def?._id || null;
    }
    await Transaction.create({
      userId: req.user.id,
      name: bill.name,
      type: bill.type,
      amount: amt,
      category: bill.category || "Bills",
      date: when,
      accountId: payAccountId,
      billId: bill._id,
      note: bill.note,
    });
  }

  bill.lastPaidDate = when;
  if (bill.recurrence === "none") {
    bill.isPaid = true;
    bill.isActive = false;
  } else {
    bill.dueDate = stepNext(bill.dueDate, bill.recurrence, bill.interval);
    if (isPastEnd(bill)) {
      bill.isPaid = true;
      bill.isActive = false;
    }
  }
  await bill.save();

  res.status(200).json({ success: true, data: bill });
});
