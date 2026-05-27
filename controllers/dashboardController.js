import Transaction from "../models/transactionModel.js";
import SavingsGoal from "../models/savingGoalModel.js";
import Budget from "../models/budgetModel.js";
import { generateDueTransactions } from "./recurringController.js";

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const getDashboard = async (req, res) => {
  try {
    // 1. Materialize any due recurring transactions first
    await generateDueTransactions(req.user.id);

    // 2. Pull transactions once, sorted desc
    const transactions = await Transaction.find({ userId: req.user.id }).sort({
      date: -1,
    });

    // 3. Aggregate income / expense / saving totals
    //    NOTE: the model enum is "saving" (singular) — earlier code used
    //    "savings" and silently returned 0.
    let totalIncome = 0;
    let totalExpense = 0;
    let totalSaving = 0;
    const monthlyData = {};
    const categoryExpenseMap = {};
    const categorySpendMap = {};

    for (const t of transactions) {
      const amount = t.amount || 0;

      if (t.type === "income") totalIncome += amount;
      else if (t.type === "expense") totalExpense += amount;
      else if (t.type === "saving") totalSaving += amount;

      // Monthly summary — key includes the year so different years don't
      // collide on the same short month name.
      const date = new Date(t.date);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          name: `${monthNames[date.getMonth()]} ${date.getFullYear()}`,
          Expenses: 0,
          Income: 0,
          Savings: 0,
        };
      }
      if (t.type === "expense") monthlyData[monthKey].Expenses += amount;
      else if (t.type === "income") monthlyData[monthKey].Income += amount;
      else if (t.type === "saving") monthlyData[monthKey].Savings += amount;

      // Per-category breakdowns — expenses for the doughnut, and a
      // separate "spend by category" used by the budget table.
      if (t.type === "expense") {
        categoryExpenseMap[t.category] =
          (categoryExpenseMap[t.category] || 0) + amount;
        categorySpendMap[t.category] =
          (categorySpendMap[t.category] || 0) + amount;
      }
    }

    const balance = totalIncome - (totalExpense + totalSaving);

    const monthlySummary = Object.keys(monthlyData)
      .sort()
      .map((key) => monthlyData[key]);

    const categoryWiseExpense = Object.entries(categoryExpenseMap).map(
      ([name, value]) => ({ name, value })
    );

    // 4. Savings goals summary
    const goals = await SavingsGoal.find({ userId: req.user.id });
    const totalGoalTarget = goals.reduce(
      (sum, g) => sum + (g.targetAmount || 0),
      0
    );
    const totalGoalSaved = goals.reduce(
      (sum, g) => sum + (g.savedAmount || 0),
      0
    );
    const activeGoals = goals.filter((g) => g.status === "active").length;
    const completedGoals = goals.filter((g) => g.status === "completed").length;

    // 5. Budgets — current-month budget if it exists, otherwise newest.
    //    Use the real model field (`totalBudget`), not the previous `b.amount`
    //    which was undefined and made `totalBudget` NaN on the client.
    const now = new Date();
    let activeBudget = await Budget.findOne({
      userId: req.user.id,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ startDate: -1 });

    if (!activeBudget) {
      activeBudget = await Budget.findOne({ userId: req.user.id }).sort({
        startDate: -1,
      });
    }

    const totalBudget = activeBudget?.totalBudget || 0;
    // Budget caps spending, not savings — so utilized = expenses only.
    const utilizedBudget = totalExpense;
    const remainingBudget = totalBudget - utilizedBudget;

    const categoryWiseBudget = (activeBudget?.categories || []).map((c) => {
      const spent = categorySpendMap[c.category] || 0;
      return {
        category: c.category,
        budget: c.amount,
        spent,
        remaining: c.amount - spent,
      };
    });

    // 6. Response
    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        totalSaving,
        balance,

        budget: {
          totalBudget,
          utilizedBudget,
          remainingBudget,
        },

        savingsGoals: {
          totalTarget: totalGoalTarget,
          totalSaved: totalGoalSaved,
          activeGoals,
          completedGoals,
        },

        monthlySummary,
        categoryWiseExpense,
        categoryWiseBudget,

        recentTransactions: transactions.slice(0, 10),
      },
    });
  } catch (err) {
    console.error("getDashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
