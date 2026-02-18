/**
 * Savings Goal Controller
 * 
 * Handles CRUD operations for savings goals and contribution tracking.
 */
import SavingsGoal from "../models/savingGoalModel.js";
import Contribution from "../models/contributionModel.js";
import Transaction from "../models/transactionModel.js";

// ===================================
// Goal CRUD Operations
// ===================================

/**
 * Create a new savings goal
 * POST /api/savings-goals
 */
export const createGoal = async (req, res) => {
  try {
    const { name, category, targetAmount, targetDate, color } = req.body;
    
    const goal = await SavingsGoal.create({ 
      userId: req.user.id, 
      name, 
      category, 
      targetAmount, 
      targetDate,
      color
    });
    
    res.status(201).json({ success: true, data: goal });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating goal", error: error.message });
  }
};

/**
 * Get all goals for a user with summary
 * GET /api/savings-goals
 */
export const getGoals = async (req, res) => {
  try {
    const goals = await SavingsGoal.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    const totalActive = goals.filter(g => g.status === "active").length;
    const totalCompleted = goals.filter(g => g.status === "completed").length;
    const totalSavings = goals.reduce((sum, g) => sum + g.savedAmount, 0);
    const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);

    res.json({
      success: true,
      summary: {
        totalGoals: goals.length,
        totalActive,
        totalCompleted,
        totalSavings,
        totalTarget
      },
      data: goals
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching goals", error: error.message });
  }
};

/**
 * Get a single goal with its contributions
 * GET /api/savings-goals/:id
 */
export const getGoalById = async (req, res) => {
  try {
    const goal = await SavingsGoal.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    // Get contributions for this goal
    const contributions = await Contribution.find({ savingsGoalId: req.params.id })
      .sort({ date: -1 });

    res.json({ 
      success: true, 
      data: { 
        ...goal.toJSON(), 
        contributions 
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching goal", error: error.message });
  }
};

/**
 * Update goal details
 * PUT /api/savings-goals/:id
 */
export const updateGoal = async (req, res) => {
  try {
    const { name, category, targetAmount, targetDate, color } = req.body;
    
    const goal = await SavingsGoal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { name, category, targetAmount, targetDate, color },
      { new: true, runValidators: true }
    );
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    res.json({ success: true, data: goal });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating goal", error: error.message });
  }
};

/**
 * Update goal status (active/completed/cancelled)
 * PATCH /api/savings-goals/:id/status
 */
export const updateGoalStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!["active", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const goal = await SavingsGoal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { status },
      { new: true }
    );
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    res.json({ success: true, data: goal });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating goal status", error: error.message });
  }
};

/**
 * Delete a goal and its contributions
 * DELETE /api/savings-goals/:id
 */
export const deleteGoal = async (req, res) => {
  try {
    const goal = await SavingsGoal.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    // Also delete all contributions for this goal
    await Contribution.deleteMany({ savingsGoalId: req.params.id });

    res.json({ success: true, message: "Goal and contributions deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting goal", error: error.message });
  }
};

// ===================================
// Contribution Operations
// ===================================

/**
 * Add a contribution (deposit) to a goal
 * POST /api/savings-goals/:id/contribute
 */
export const contributeToGoal = async (req, res) => {
  try {
    const { amount, note, date } = req.body;
    const goalId = req.params.id || req.body._id;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be positive" });
    }

    // Find the goal
    const goal = await SavingsGoal.findOne({ 
      _id: goalId, 
      userId: req.user.id 
    });
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }
    
    if (goal.status !== "active") {
      return res.status(400).json({ success: false, message: "Goal is not active" });
    }

    // Create contribution record
    const contribution = await Contribution.create({
      userId: req.user.id,
      savingsGoalId: goalId,
      amount,
      type: "deposit",
      note: note || `Contribution to ${goal.name}`,
      date: date || new Date()
    });

    // Create savings transaction for tracking
    const transaction = await Transaction.create({
      userId: req.user.id,
      type: "saving",
      amount,
      name: goal.name,
      category: goal.category,
      note: note || `Contribution to ${goal.name}`,
      date: date || new Date(),
      savingsGoalId: goalId
    });

    // Update goal savedAmount
    goal.savedAmount = Number(goal.savedAmount) + Number(amount);
    
    // Auto-complete if target reached
    if (goal.savedAmount >= goal.targetAmount) {
      goal.status = "completed";
    }
    await goal.save();

    res.status(201).json({ 
      success: true, 
      data: { 
        goal, 
        contribution, 
        transaction 
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error contributing to goal", error: error.message });
  }
};

/**
 * Withdraw (utilize) from a goal
 * POST /api/savings-goals/:id/withdraw
 */
export const withdrawFromGoal = async (req, res) => {
  try {
    const { amount, note, date } = req.body;
    const goalId = req.params.id || req.body.goalId;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be positive" });
    }

    // Find the goal
    const goal = await SavingsGoal.findOne({ 
      _id: goalId, 
      userId: req.user.id 
    });
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }
    
    if (goal.status !== "active") {
      return res.status(400).json({ success: false, message: "Goal is not active" });
    }

    if (amount > goal.savedAmount) {
      return res.status(400).json({ success: false, message: "Insufficient saved amount" });
    }

    // Create withdrawal contribution record
    const contribution = await Contribution.create({
      userId: req.user.id,
      savingsGoalId: goalId,
      amount,
      type: "withdrawal",
      note: note || `Withdrawal from ${goal.name}`,
      date: date || new Date()
    });

    // Create expense transaction for tracking
    const transaction = await Transaction.create({
      userId: req.user.id,
      type: "expense",
      amount,
      name: goal.name,
      category: goal.category,
      note: note || `Withdrawal from ${goal.name}`,
      date: date || new Date(),
      savingsGoalId: goalId
    });

    // Update goal savedAmount
    goal.savedAmount = Number(goal.savedAmount) - Number(amount);
    await goal.save();

    res.status(201).json({ 
      success: true, 
      data: { 
        goal, 
        contribution, 
        transaction 
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error withdrawing from goal", error: error.message });
  }
};

/**
 * Get all contributions for a goal
 * GET /api/savings-goals/:id/contributions
 */
export const getContributions = async (req, res) => {
  try {
    const goalId = req.params.id;

    // Verify goal belongs to user
    const goal = await SavingsGoal.findOne({ 
      _id: goalId, 
      userId: req.user.id 
    });
    
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    // Get contributions with pagination
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const contributions = await Contribution.find({ savingsGoalId: goalId })
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Contribution.countDocuments({ savingsGoalId: goalId });

    // Calculate totals
    const allContributions = await Contribution.find({ savingsGoalId: goalId });
    const totalDeposits = allContributions
      .filter(c => c.type === "deposit")
      .reduce((sum, c) => sum + c.amount, 0);
    const totalWithdrawals = allContributions
      .filter(c => c.type === "withdrawal")
      .reduce((sum, c) => sum + c.amount, 0);

    res.json({
      success: true,
      summary: {
        totalContributions: total,
        totalDeposits,
        totalWithdrawals,
        netSaved: totalDeposits - totalWithdrawals
      },
      data: contributions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching contributions", error: error.message });
  }
};

/**
 * Delete a contribution
 * DELETE /api/savings-goals/:goalId/contributions/:contributionId
 */
export const deleteContribution = async (req, res) => {
  try {
    const { goalId, contributionId } = req.params;

    // Find the contribution
    const contribution = await Contribution.findOne({
      _id: contributionId,
      savingsGoalId: goalId,
      userId: req.user.id
    });

    if (!contribution) {
      return res.status(404).json({ success: false, message: "Contribution not found" });
    }

    // Find the goal
    const goal = await SavingsGoal.findOne({
      _id: goalId,
      userId: req.user.id
    });

    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    // Reverse the contribution effect on savedAmount
    if (contribution.type === "deposit") {
      goal.savedAmount = Math.max(0, goal.savedAmount - contribution.amount);
    } else {
      goal.savedAmount = goal.savedAmount + contribution.amount;
    }

    // If goal was completed but now below target, set back to active
    if (goal.status === "completed" && goal.savedAmount < goal.targetAmount) {
      goal.status = "active";
    }

    await goal.save();
    await Contribution.findByIdAndDelete(contributionId);

    res.json({ 
      success: true, 
      message: "Contribution deleted successfully",
      data: goal
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting contribution", error: error.message });
  }
};

// Legacy export for backward compatibility
export const utilizeGoal = withdrawFromGoal;