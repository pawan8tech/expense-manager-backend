import Transaction from "../models/transactionModel.js";
import { generateDueTransactions } from "./recurringController.js";

export const getDashboard = async (req, res) => {
  try {
    // 1️⃣ First generate any missing recurring transactions
    await generateDueTransactions(req.user.id);

    // 2️⃣ Fetch all user transactions
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ date: -1 });

    // 3️⃣ Calculate income & expense totals
    const totalIncome = transactions
      .filter(t => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpense = transactions
      .filter(t => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpense;

    // 4️⃣ Group monthly summary (useful for charts)
    const monthlySummary = {};
    transactions.forEach(t => {
      const monthKey = new Date(t.date).toISOString().slice(0, 7); // e.g., "2025-09"
      if (!monthlySummary[monthKey]) {
        monthlySummary[monthKey] = { income: 0, expense: 0 };
      }
      if (t.type === "income") {
        monthlySummary[monthKey].income += t.amount;
      } else {
        monthlySummary[monthKey].expense += t.amount;
      }
    });

    // 5️⃣ Send response
    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        balance,
        recentTransactions: transactions.slice(0, 5), // latest 5
        monthlySummary,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
