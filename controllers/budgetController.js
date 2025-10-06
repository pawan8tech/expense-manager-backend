// controllers/budgetController.js
import Budget from "../models/budgetModel.js";
import transactionModel from "../models/transactionModel.js";

// Add Budget
export const addBudget = async (req, res) => {
  try {
    const { userId, name, totalBudget, categories, startDate, endDate } = req.body;

    // validation: sum of categories should not exceed total
    const categorySum = categories?.reduce((sum, c) => sum + c.amount, 0) || 0;
    if (categorySum > totalBudget) {
      return res.status(400).json({
        message: "Sum of category budgets cannot exceed total budget",
      });
    }

    const newBudget = new Budget({
      userId,
      name,
      totalBudget,
      categories,
      startDate,
      endDate,
    });

    await newBudget.save();
    res.status(201).json(newBudget);
  } catch (error) {
    res.status(500).json({ message: "Error adding budget", error: error.message });
  }
};

// Get budgets (current month or specific month)
export const getBudgets = async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    // Find budgets for that month (assuming your budget has startDate/endDate fields)
    const budgets = await Budget.find({
      userId,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    });

    const results = [];

    for (const budget of budgets) {
      // fetch transactions within budget period
      const transactions = await transactionModel.find({
        userId,
        date: { $gte: budget.startDate, $lte: budget.endDate },
      });

      // total spent
      const totalSpent = transactions.reduce(
        (sum, t) => sum + (t.type === "expense" ? t.amount : 0),
        0
      );

      // category-wise spent
      const categorySpentMap = {};
      transactions.forEach((t) => {
        if (t.type === "expense") {
          categorySpentMap[t.category] =
            (categorySpentMap[t.category] || 0) + t.amount;
        }
      });

      // build category utilization
      const categoriesWithUtilization = budget.categories.map((c) => {
        const spent = categorySpentMap[c.category] || 0;
        return {
          category: c.category,
          budget: c.amount,
          spent,
          remaining: c.amount - spent,
        };
      });

      results.push({
        _id: budget._id,
        name: budget.name,
        totalBudget: budget.totalBudget,
        totalSpent,
        remainingTotal: budget.totalBudget - totalSpent,
        categories: categoriesWithUtilization,
        startDate: budget.startDate,
        endDate: budget.endDate
      });
    }
    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching budgets", error: error.message });
  }
};

// Update Budget
export const updateBudget = async (req, res) => {
  try {
    const { totalBudget, categories } = req.body;

    // validation: sum of categories should not exceed total
    const categorySum = categories?.reduce((sum, c) => sum + c.amount, 0) || 0;
    if (categorySum > totalBudget) {
      return res.status(400).json({
        message: "Sum of category budgets cannot exceed total budget",
      });
    }

    const updated = await Budget.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!updated) return res.status(404).json({ message: "Budget not found" });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Error updating budget", error: error.message });
  }
};

// Delete Budget
export const deleteBudget = async (req, res) => {
  try {
    const deleted = await Budget.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Budget not found" });
    res.json({ message: "Budget deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting budget", error: error.message });
  }
};
