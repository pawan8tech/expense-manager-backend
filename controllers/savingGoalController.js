import SavingsGoal from "../models/savingGoalModel.js";
import Transaction from "../models/transactionModel.js";

// ✅ Create a new goal
export const createGoal = async (req, res) => {
  try {
    const { name, category, targetAmount, targetDate } = req.body;
    const goal = await SavingsGoal.create({ userId: req.user.id, name, category, targetAmount, targetDate });
    res.status(201).json(goal);
  } catch (error) {
    res.status(500).json({ message: "Error creating goal", error: error.message });
  }
};

// ✅ Contribute to goal
export const contributeToGoal = async (req, res) => {
  try {
    const { userId, goalId, contributionAmount, contributionDate, category } = req.body;

    const goal = await SavingsGoal.findById(goalId);
    if (!goal) return res.status(404).json({ message: "Goal not found" });
    if (goal.status !== "active") return res.status(400).json({ message: "Goal is not active" });

    // Create savings transaction
    const txn = await Transaction.create({
      userId,
      type: "savings",
      amount: contributionAmount,
      
      category: category || goal.category,
      date: contributionDate || new Date(),
      savingsGoalId: goalId
    });

    // Update goal savedAmount
    goal.savedAmount += contributionAmount;
    if (goal.savedAmount >= goal.targetAmount) {
      goal.status = "completed";
    }
    await goal.save();

    res.status(201).json({ goal, transaction: txn });
  } catch (error) {
    res.status(500).json({ message: "Error contributing to goal", error: error.message });
  }
};

// ✅ Utilize money from goal
export const utilizeGoal = async (req, res) => {
  try {
    const { userId, goalId, amount, category, date } = req.body;

    const goal = await SavingsGoal.findById(goalId);
    if (!goal) return res.status(404).json({ message: "Goal not found" });
    if (goal.status !== "active") return res.status(400).json({ message: "Goal is not active" });

    if (amount > goal.savedAmount) return res.status(400).json({ message: "Insufficient saved amount" });

    // Create expense transaction
    const txn = await Transaction.create({
      userId,
      type: "expense",
      amount,
      category: category || goal.category,
      date: date || new Date(),
      savingsGoalId: goalId
    });

    goal.savedAmount -= amount;
    await goal.save();

    res.status(201).json({ goal, transaction: txn });
  } catch (error) {
    res.status(500).json({ message: "Error utilizing goal", error: error.message });
  }
};

// ✅ Get all goals for a user
export const getGoals = async (req, res) => {
  try {
    // const { userId } = req.user.id;
    const goals = await SavingsGoal.find({ userId : req.user.id }); 

    console.log(goals);

    const totalActive = goals.filter(g => g.status === "active").length;
    const totalCompleted = goals.filter(g => g.status === "completed").length;
    const totalSavings = goals?.reduce((sum, g) => sum + g.savedAmount, 0);
    const totalTarget = goals?.reduce((sum, g) => sum + g.targetAmount, 0);

    res.json({
      summary: {
        totalGoals: goals.length,
        totalActive,
        totalCompleted,
        totalSavings,
        totalTarget
      },
      data: goals});
  } catch (error) {
    res.status(500).json({ message: "Error fetching goals", error: error.message });
  }
};

// ✅ Update goal status (manually complete/cancel)
export const updateGoalStatus = async (req, res) => {
  try {
    const { goalId, status } = req.body;
    const goal = await SavingsGoal.findById(goalId);
    if (!goal) return res.status(404).json({ message: "Goal not found" });

    if (!["active", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    goal.status = status;
    await goal.save();

    res.json(goal);
  } catch (error) {
    res.status(500).json({ message: "Error updating goal status", error: error.message });
  }
};
