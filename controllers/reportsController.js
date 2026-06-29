import asyncHandler from "express-async-handler";
import Transaction from "../models/transactionModel.js";
import Budget from "../models/budgetModel.js";
import SavingsGoal from "../models/savingGoalModel.js";

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Bucket key generator for a Date based on granularity.
 * Returns { key, label } so the frontend gets a sortable key + readable label.
 */
const bucketKey = (date, granularity) => {
  const d = new Date(date);
  switch (granularity) {
    case "day": {
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      });
      return { key, label };
    }
    case "week": {
      // ISO week — Monday-anchored
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
      const key = `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
      const label = `W${weekNo} ${tmp.getUTCFullYear()}`;
      return { key, label };
    }
    case "year": {
      const key = `${d.getFullYear()}`;
      return { key, label: key };
    }
    case "month":
    default: {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      return { key, label };
    }
  }
};

export const getReports = asyncHandler(async (req, res) => {
  // The reports endpoint has two server-side params:
  //   - date range (global filter on the page)
  //   - granularity (drives bucketing for the Cashflow Trend chart)
  // Section-local filters (sort, limit, status, series visibility) are
  // applied on the client over the data we return below.
  const { startDate, endDate, granularity = "month" } = req.query;

  // Planned/future event spends are excluded from reports — they aren't real
  // cashflow yet and would distort net / savings-rate figures.
  const filter = { userId: req.user.id, isPlanned: { $ne: true } };

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  const transactions = await Transaction.find(filter).sort({ date: -1 });

  // ----- summary totals (always cross-type to compute net / savings rate) -----
  let totalIncome = 0;
  let totalExpense = 0;
  let totalSaving = 0;

  // ----- trend buckets -----
  const trendBuckets = new Map();
  // ----- category aggregates -----
  const expenseByCat = new Map();
  const incomeByCat = new Map();
  // ----- day-of-week spending -----
  const dowExpense = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));

  for (const t of transactions) {
    const amount = t.amount || 0;
    const d = new Date(t.date);

    if (t.type === "income") totalIncome += amount;
    else if (t.type === "expense") totalExpense += amount;
    else if (t.type === "saving") totalSaving += amount;

    // Trend bucketing
    const { key, label } = bucketKey(d, granularity);
    if (!trendBuckets.has(key)) {
      trendBuckets.set(key, { key, name: label, Income: 0, Expenses: 0, Savings: 0, Net: 0 });
    }
    const bucket = trendBuckets.get(key);
    if (t.type === "income") bucket.Income += amount;
    else if (t.type === "expense") bucket.Expenses += amount;
    else if (t.type === "saving") bucket.Savings += amount;
    bucket.Net = bucket.Income - bucket.Expenses;

    if (t.type === "expense") {
      expenseByCat.set(t.category, (expenseByCat.get(t.category) || 0) + amount);
      const dow = d.getDay();
      dowExpense[dow].total += amount;
      dowExpense[dow].count += 1;
    } else if (t.type === "income") {
      incomeByCat.set(t.category, (incomeByCat.get(t.category) || 0) + amount);
    }
  }

  const trend = Array.from(trendBuckets.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );

  const toCategoryArr = (map) => {
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    return Array.from(map.entries())
      .map(([name, value]) => ({
        name,
        value,
        percent: total > 0 ? (value / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  };

  const expenseByCategory = toCategoryArr(expenseByCat);
  const incomeByCategory = toCategoryArr(incomeByCat);

  // Top transactions (respect the type filter if set, otherwise show both)
  const expenseTxs = transactions.filter((t) => t.type === "expense");
  const incomeTxs = transactions.filter((t) => t.type === "income");

  // Return up to 20 so the frontend section filter (Top 5 / 10 / 20)
  // can slice without a refetch.
  const topN = (arr, n = 20) =>
    [...arr]
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, n)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        amount: t.amount,
        category: t.category,
        date: t.date,
      }));

  const topExpenses = topN(expenseTxs);
  const topIncomes = topN(incomeTxs);

  // Day-of-week spending
  const dayOfWeekSpending = dowExpense.map((row, idx) => ({
    day: dayNames[idx],
    total: row.total,
    count: row.count,
  }));

  // Averages — relative to the range
  let rangeStart, rangeEnd;
  if (startDate) rangeStart = new Date(startDate);
  else if (transactions.length)
    rangeStart = new Date(transactions[transactions.length - 1].date);
  if (endDate) rangeEnd = new Date(endDate);
  else if (transactions.length) rangeEnd = new Date(transactions[0].date);

  let days = 1;
  if (rangeStart && rangeEnd) {
    days = Math.max(
      1,
      Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1
    );
  }
  const months = Math.max(1, days / 30);

  const averages = {
    dailyExpense: totalExpense / days,
    monthlyExpense: totalExpense / months,
    dailyIncome: totalIncome / days,
    monthlyIncome: totalIncome / months,
  };

  // Budget vs Actual — pull active budgets that overlap the range
  const budgetMatch = { userId: req.user.id };
  if (rangeStart && rangeEnd) {
    budgetMatch.startDate = { $lte: rangeEnd };
    budgetMatch.endDate = { $gte: rangeStart };
  }
  const budgets = await Budget.find(budgetMatch).sort({ startDate: -1 });

  // Merge category budgets across overlapping budget docs
  const budgetMap = new Map();
  for (const b of budgets) {
    for (const c of b.categories || []) {
      budgetMap.set(c.category, (budgetMap.get(c.category) || 0) + (c.amount || 0));
    }
  }
  const spendMap = new Map(expenseByCategory.map((c) => [c.name, c.value]));
  const allCats = new Set([...budgetMap.keys(), ...spendMap.keys()]);
  const budgetVsActual = Array.from(allCats).map((cat) => {
    const budget = budgetMap.get(cat) || 0;
    const spent = spendMap.get(cat) || 0;
    return {
      category: cat,
      budget,
      spent,
      remaining: budget - spent,
    };
  });

  // Savings goals progress
  const goals = await SavingsGoal.find({ userId: req.user.id });
  const savingsProgress = goals.map((g) => ({
    _id: g._id,
    name: g.name,
    targetAmount: g.targetAmount,
    savedAmount: g.savedAmount,
    percent:
      g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0,
    status: g.status,
    targetDate: g.targetDate,
  }));

  const netSavings = totalIncome - totalExpense;
  const savingsRate =
    totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

  res.status(200).json({
    success: true,
    data: {
      summary: {
        totalIncome,
        totalExpense,
        totalSaving,
        netSavings,
        savingsRate,
        transactionCount: transactions.length,
        rangeStart,
        rangeEnd,
        days,
        averages,
      },
      trend,
      expenseByCategory,
      incomeByCategory,
      topExpenses,
      topIncomes,
      dayOfWeekSpending,
      budgetVsActual,
      savingsProgress,
    },
  });
});
