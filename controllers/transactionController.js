// src/controllers/transactionController.js
import asyncHandler from "express-async-handler";
import Transaction from "../models/transactionModel.js"; 
// src/controllers/transactionController.js
import { generateDueTransactions } from "./recurringController.js";
import mongoose from "mongoose";

export const getTransactions = asyncHandler(async (req, res) => {
  await generateDueTransactions(req.user.id);

  // Pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Filter parameters
  const { startDate, endDate, type, category, search } = req.query;
  const filter = { userId: req.user.id };

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
    filter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
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
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit);

  // Get counts by type for the current filter (excluding type filter)
  const countFilter = { userId: req.user.id };
  if (startDate && endDate) {
    countFilter.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
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
    // Use the filter dates as current period
    currentPeriodStart = new Date(startDate);
    currentPeriodEnd = new Date(endDate);
    
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
  const currentSavings = currentIncome - currentExpense;

  // Previous period aggregation
  const prevPeriodFilter = {
    userId,
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
  const prevSavings = prevIncome - prevExpense;

  // All time aggregation for current balance
  const allTimeAggregation = await Transaction.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" }
      }
    }
  ]);

  const totalIncome = allTimeAggregation.find(a => a._id === 'income')?.total || 0;
  const totalExpense = allTimeAggregation.find(a => a._id === 'expense')?.total || 0;
  const currentBalance = totalIncome - totalExpense;

  // Calculate percentage changes
  const incomeChange = calcPercentChange(currentIncome, prevIncome);
  const expenseChange = calcPercentChange(currentExpense, prevExpense);
  const savingsChange = calcPercentChange(currentSavings, prevSavings);

  // Calculate balance change (compare balance at end of current period vs end of previous period)
  // For simplicity, we'll compare current savings to previous savings as balance indicator
  const balanceChange = calcPercentChange(currentSavings, prevSavings);

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
