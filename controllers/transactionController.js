// src/controllers/transactionController.js
import asyncHandler from "express-async-handler";
import Transaction from "../models/transactionModel.js"; 
// src/controllers/transactionController.js
import { generateDueTransactions } from "./recurringController.js";

export const getTransactions = asyncHandler(async (req, res) => {
  await generateDueTransactions(req.user.id);

  const { startDate, endDate, type, category } = req.query;
  const filter = { userId: req.user.id };

  if (type) filter.type = type;
  if (category) filter.category = category;
  if (startDate && endDate) {
    filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const transactions = await Transaction.find(filter).sort({ date: -1 });

  // ---------- Summary Calculations ----------
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const monthFilter = {
    userId: req.user.id,
    date: { $gte: firstDayOfMonth, $lte: lastDayOfMonth },
  };

  const monthlyTransactions = await Transaction.find(monthFilter);

  const incomeThisMonth = monthlyTransactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const expenseThisMonth = monthlyTransactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  // Current balance = total income - total expense (all time)
  const allTransactions = await Transaction.find({ userId: req.user.id });

  const totalIncome = allTransactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = allTransactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  const currentBalance = totalIncome - totalExpense;

  // Savings = income - expense of this month
  const savings = incomeThisMonth - expenseThisMonth;

  res.status(200).json({
    success: true,
    data: transactions,
    summary: {
      currentBalance,
      savings,
      incomeThisMonth,
      expenseThisMonth,
    },
  });
})

  
// Add Transaction
export const addTransaction = asyncHandler(async (req, res) => { 
    const { type, amount, category, name, date } = req.body;
    const transaction = new Transaction({
      userId: req.user.id,...req.body});

    await transaction.save();
    res.status(201).json({ success: true, data: transaction })  
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
    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true }
    );
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.status(200).json({ success: true, data: transaction });
});

// Delete Transaction
export const deleteTransaction =asyncHandler(async (req, res) => {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.status(200).json({ success: true, message: "Transaction deleted" });
});
