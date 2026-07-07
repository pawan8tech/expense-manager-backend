import asyncHandler from "express-async-handler";
import Lending from "../models/lendingModel.js";
import Account from "../models/accountModel.js";
import Transaction from "../models/transactionModel.js";
import { computeLendingBalances } from "../utils/lendingBalances.js";

// Build the single-sided transfer for a money movement.
//   flow "out" → money leaves your account  (accountId set)
//   flow "in"  → money enters your account  (toAccountId set)
const buildMoneyTxn = ({ userId, lendingId, flow, accountId, amount, name, date, note }) => ({
  userId,
  name,
  type: "transfer",
  amount,
  category: "Lending",
  date: date || Date.now(),
  accountId: flow === "out" ? accountId : null,
  toAccountId: flow === "in" ? accountId : null,
  lendingId,
  note,
});

// GET /api/lendings
export const listLendings = asyncHandler(async (req, res) => {
  const { lendings, totals } = await computeLendingBalances(req.user.id);
  res.status(200).json({ success: true, data: lendings, totals });
});

// POST /api/lendings
export const createLending = asyncHandler(async (req, res) => {
  const { person, direction, amount, accountId, date, note } = req.body;

  if (!person || !String(person).trim()) {
    return res.status(400).json({ success: false, message: "Person's name is required" });
  }
  if (!["lent", "borrowed"].includes(direction)) {
    return res.status(400).json({ success: false, message: "Direction must be lent or borrowed" });
  }
  if (!(Number(amount) > 0)) {
    return res.status(400).json({ success: false, message: "Amount must be a positive number" });
  }
  const account = await Account.findOne({ _id: accountId, userId: req.user.id });
  if (!account) {
    return res.status(404).json({ success: false, message: "Account not found" });
  }

  const lending = await Lending.create({
    userId: req.user.id,
    person: String(person).trim(),
    direction,
    note: note || "",
  });

  // Lent → money out of your account; Borrowed → money in.
  const flow = direction === "lent" ? "out" : "in";
  const name =
    direction === "lent" ? `Lent to ${lending.person}` : `Borrowed from ${lending.person}`;
  await Transaction.create(
    buildMoneyTxn({
      userId: req.user.id,
      lendingId: lending._id,
      flow,
      accountId: account._id,
      amount: Number(amount),
      name,
      date,
      note,
    })
  );

  res.status(201).json({ success: true, data: lending });
});

/**
 * POST /api/lendings/:id/entry
 * action "settle"   → a repayment (reverses the original flow)
 * action "increase" → lend/borrow more (same as the original flow)
 */
export const addLendingEntry = asyncHandler(async (req, res) => {
  const lending = await Lending.findOne({ _id: req.params.id, userId: req.user.id });
  if (!lending) return res.status(404).json({ success: false, message: "Lending not found" });

  const { action = "settle", amount, accountId, date, note } = req.body;
  if (!(Number(amount) > 0)) {
    return res.status(400).json({ success: false, message: "Amount must be a positive number" });
  }
  const account = await Account.findOne({ _id: accountId, userId: req.user.id });
  if (!account) return res.status(404).json({ success: false, message: "Account not found" });

  const isLent = lending.direction === "lent";
  // Original flow: lent = out, borrowed = in. Settle reverses it.
  const originalFlow = isLent ? "out" : "in";
  const flow = action === "increase" ? originalFlow : originalFlow === "out" ? "in" : "out";

  let name;
  if (action === "increase") {
    name = isLent ? `Lent more to ${lending.person}` : `Borrowed more from ${lending.person}`;
  } else {
    name = isLent ? `Repayment from ${lending.person}` : `Repaid ${lending.person}`;
  }

  await Transaction.create(
    buildMoneyTxn({
      userId: req.user.id,
      lendingId: lending._id,
      flow,
      accountId: account._id,
      amount: Number(amount),
      name,
      date,
      note,
    })
  );

  // Recompute outstanding to flip status open/settled.
  const { lendings } = await computeLendingBalances(req.user.id);
  const current = lendings.find((l) => String(l._id) === String(lending._id));
  lending.status = current && current.outstanding <= 0 ? "settled" : "open";
  await lending.save();

  res.status(200).json({ success: true, data: lending });
});

// PUT /api/lendings/:id — edit the person/note (direction and amounts are
// derived from transactions and aren't editable here).
export const updateLending = asyncHandler(async (req, res) => {
  const lending = await Lending.findOne({ _id: req.params.id, userId: req.user.id });
  if (!lending) return res.status(404).json({ success: false, message: "Lending not found" });

  const { person, note } = req.body;
  if (person !== undefined) {
    if (!String(person).trim()) {
      return res.status(400).json({ success: false, message: "Person's name is required" });
    }
    lending.person = String(person).trim();
  }
  if (note !== undefined) lending.note = note;
  await lending.save();

  res.status(200).json({ success: true, data: lending });
});

// GET /api/lendings/:id/history — the individual moves for a lending.
export const getLendingHistory = asyncHandler(async (req, res) => {
  const lending = await Lending.findOne({ _id: req.params.id, userId: req.user.id });
  if (!lending) return res.status(404).json({ success: false, message: "Lending not found" });

  const txns = await Transaction.find({ userId: req.user.id, lendingId: lending._id }).sort({ date: -1 });
  const history = txns.map((t) => ({
    _id: t._id,
    amount: t.amount,
    date: t.date,
    note: t.note,
    name: t.name,
    flow: t.accountId ? "out" : "in", // out = money left you; in = money came in
  }));
  res.status(200).json({ success: true, data: history });
});

// DELETE /api/lendings/:id — removes the ledger and all its transactions
// (restoring the affected account balances).
export const deleteLending = asyncHandler(async (req, res) => {
  const lending = await Lending.findOne({ _id: req.params.id, userId: req.user.id });
  if (!lending) return res.status(404).json({ success: false, message: "Lending not found" });

  await Transaction.deleteMany({ userId: req.user.id, lendingId: lending._id });
  await lending.deleteOne();

  res.status(200).json({ success: true, message: "Lending deleted" });
});
