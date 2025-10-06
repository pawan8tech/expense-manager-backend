import Transaction from "../models/transactionModel.js";
import SavingsGoal from "../models/savingGoalModel.js";
import Budget from "../models/budgetModel.js";
import { generateDueTransactions } from "./recurringController.js";

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const getDashboard = async (req, res) => {
  try {
    // 1️⃣ Generate missing recurring transactions
    await generateDueTransactions(req.user.id);

    // 2️⃣ Fetch all user transactions
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ date: -1 });

    // 3️⃣ Income, Expense, Savings totals
    const totalIncome = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
    const totalSavings = transactions.filter(t => t.type === "savings").reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - (totalExpense + totalSavings);

    // 4️⃣ Group monthly summary (income, expense, savings)
    const monthlyData = {};

    transactions.forEach(t => {
      const date = new Date(t.date);
      const monthKey = date.toISOString().slice(0, 7); // "2025-09"
      const monthName = monthNames[date.getMonth()];

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { name: monthName, Expenses: 0, Income: 0, Savings: 0 };
      }

      if (t.type === "expense") monthlyData[monthKey].Expenses += t.amount;
      if (t.type === "income") monthlyData[monthKey].Income += t.amount;
      if (t.type === "savings") monthlyData[monthKey].Savings += t.amount;
    });

    // Convert object → array sorted by month
    const monthlySummary = Object.keys(monthlyData)
      .sort()
      .map(key => monthlyData[key]);

    // 5️⃣ Category-wise expense breakdown (for doughnut chart)
    const categoryWiseExpense = {};
    transactions.filter(t => t.type === "expense").forEach(t => {
      if (!categoryWiseExpense[t.category]) categoryWiseExpense[t.category] = 0;
      categoryWiseExpense[t.category] += t.amount;
    });
    // Convert to array of { name, value }
    const categoryExpenseArray = Object.keys(categoryWiseExpense).map(cat => ({
      name: cat,
      value: categoryWiseExpense[cat]
    }));

    // 6️⃣ Savings Goals summary
    const goals = await SavingsGoal.find({ userId: req.user.id });
    const totalGoalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
    const totalGoalSaved = goals.reduce((sum, g) => sum + g.savedAmount, 0);
    const activeGoals = goals.filter(g => g.status === "active").length;
    const completedGoals = goals.filter(g => g.status === "completed").length;

    // 7️⃣ Budgets (Assuming monthly budget system)
    const budgets = await Budget.find({ userId: req.user.id });
    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);

    // Utilized budget = expenses + savings
    const utilizedBudget = totalExpense + totalSavings;
    const remainingBudget = totalBudget - utilizedBudget;

    // 8️⃣ Final response
    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        totalSavings,
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
        categoryWiseExpense:categoryExpenseArray,

        recentTransactions: transactions.slice(0, 10), // latest 10
      },
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
