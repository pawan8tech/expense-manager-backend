/**
 * Savings Goal Controller
 * 
 * Handles CRUD operations for savings goals and contribution tracking.
 */
import SavingsGoal from "../models/savingGoalModel.js";
import Contribution from "../models/contributionModel.js";
import Transaction from "../models/transactionModel.js";
import Account from "../models/accountModel.js";
import { ensureUserAccounts } from "./accountController.js";

// Resolve a usable account id: the one provided (if it belongs to the user),
// otherwise the user's default account. Savings movements are transfers to/from
// a real account so balances and net worth stay correct.
const resolveAccountId = async (userId, accountId) => {
  if (accountId) {
    const acc = await Account.findOne({ _id: accountId, userId });
    if (acc) return acc._id;
  }
  const def = await ensureUserAccounts(userId);
  return def?._id || null;
};

// ===================================
// SIP (automatic recurring contribution) generation
// ===================================

const stepDate = (date, frequency) => {
  const d = new Date(date);
  if (frequency === "daily") d.setDate(d.getDate() + 1);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly (default)
  return d;
};

/**
 * Materialize any due SIP contributions for a user's active goals. Lazy —
 * called when goals are read (same pattern as recurring transactions). For
 * each scheduled date from the SIP's last run up to today it records a
 * contribution, a `saving` transaction, and bumps the goal (and, for
 * investments, its current value).
 */
const generateDueSips = async (userId) => {
  const goals = await SavingsGoal.find({
    userId,
    status: "active",
    sipEnabled: true,
    sipAmount: { $gt: 0 },
  });

  const today = new Date();
  let defaultAccountId = null;

  for (const goal of goals) {
    let next = goal.sipLastRun
      ? stepDate(goal.sipLastRun, goal.sipFrequency)
      : new Date(goal.sipStartDate || goal.startDate || today);

    const isInvestment = goal.type === "investment";
    // Investments pull real money from an account; goals just reserve.
    let srcAccountId = null;
    if (isInvestment) {
      srcAccountId = goal.sipAccountId;
      if (!srcAccountId) {
        if (!defaultAccountId) defaultAccountId = (await ensureUserAccounts(userId))?._id || null;
        srcAccountId = defaultAccountId;
      }
    }

    let ran = false;
    let guard = 0;
    while (next <= today && guard++ < 600) {
      await Contribution.create({
        userId,
        savingsGoalId: goal._id,
        amount: goal.sipAmount,
        type: "deposit",
        note: `SIP contribution to ${goal.name}`,
        date: next,
      });
      if (isInvestment) {
        // Money leaves the source account into the investment (one-sided
        // transfer, isolated from income/expense).
        await Transaction.create({
          userId,
          type: "transfer",
          amount: goal.sipAmount,
          name: goal.name,
          category: "Investment",
          note: `SIP contribution to ${goal.name}`,
          date: next,
          accountId: srcAccountId,
          savingsGoalId: goal._id,
        });
        goal.currentValue = Number(goal.currentValue) + Number(goal.sipAmount);
      }
      // Goals just reserve more of their held-in account (no money moves).
      goal.savedAmount = Number(goal.savedAmount) + Number(goal.sipAmount);
      goal.sipLastRun = next;
      ran = true;
      next = stepDate(next, goal.sipFrequency);
    }

    // Auto-complete a target goal that the SIP pushed over the line.
    if (goal.type === "goal" && goal.targetAmount > 0 && goal.savedAmount >= goal.targetAmount) {
      goal.status = "completed";
    }

    if (ran) await goal.save();
  }
};

// Normalize SIP-related fields from a request body.
const pickSipFields = (body = {}) => {
  const enabled = !!body.sipEnabled;
  return {
    sipEnabled: enabled,
    sipAmount: enabled ? Number(body.sipAmount) || 0 : 0,
    sipFrequency: body.sipFrequency || "monthly",
    sipStartDate: enabled ? body.sipStartDate || new Date() : undefined,
    sipAccountId: enabled ? body.sipAccountId || null : null,
  };
};

// ===================================
// Goal CRUD Operations
// ===================================

/**
 * Create a new savings goal
 * POST /api/savings-goals
 */
export const createGoal = async (req, res) => {
  try {
    const { name, assetType, targetAmount, targetDate, color, savedAmount, currentValue } = req.body;
    const type = req.body.type === "investment" ? "investment" : "goal";

    // Validation
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    const nonNeg = (v) => v === undefined || v === null || v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);
    if (![targetAmount, savedAmount, currentValue].every(nonNeg)) {
      return res.status(400).json({ success: false, message: "Amounts must be non-negative numbers" });
    }
    if (type === "goal" && !(Number(targetAmount) > 0)) {
      return res.status(400).json({ success: false, message: "A goal needs a positive target amount" });
    }
    if (req.body.sipEnabled && !(Number(req.body.sipAmount) > 0)) {
      return res.status(400).json({ success: false, message: "SIP amount must be positive" });
    }

    const invested = Number(savedAmount) || 0;

    // A goal earmarks money inside a real account — default to the user's
    // default account if none chosen. Investments don't use a held-in account.
    const heldInAccountId =
      type === "goal" ? await resolveAccountId(req.user.id, req.body.heldInAccountId) : null;

    const goal = await SavingsGoal.create({
      userId: req.user.id,
      name,
      type,
      assetType: type === "investment" ? (assetType || "other") : undefined,
      targetAmount: Number(targetAmount) || 0,
      targetDate,
      color,
      heldInAccountId,
      // Allow recording an existing holding (invested + current value) on
      // create. For a plain goal these stay 0 and grow via contributions.
      savedAmount: invested,
      currentValue: type === "investment" ? (currentValue !== undefined ? Number(currentValue) : invested) : 0,
      ...pickSipFields(req.body),
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
    // Materialize any due SIP contributions before reading.
    await generateDueSips(req.user.id);

    const goals = await SavingsGoal.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    const totalActive = goals.filter(g => g.status === "active").length;
    const totalCompleted = goals.filter(g => g.status === "completed").length;
    const totalSavings = goals.reduce((sum, g) => sum + g.savedAmount, 0);
    const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);

    // Investment roll-up: invested vs current value vs returns.
    const investments = goals.filter(g => g.type === "investment");
    const totalInvested = investments.reduce((sum, g) => sum + (g.savedAmount || 0), 0);
    const totalInvestmentValue = investments.reduce((sum, g) => sum + (g.currentValue || 0), 0);
    const totalReturns = totalInvestmentValue - totalInvested;

    // Net amount saved this calendar month (deposits minus withdrawals) so the
    // "This Month" card on the Savings page reflects real activity.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthContributions = await Contribution.find({
      userId: req.user.id,
      date: { $gte: monthStart },
    });
    const savedThisMonth = monthContributions.reduce(
      (sum, c) => sum + (c.type === "withdrawal" ? -c.amount : c.amount),
      0
    );

    res.json({
      success: true,
      summary: {
        totalGoals: goals.length,
        totalActive,
        totalCompleted,
        totalSavings,
        totalTarget,
        savedThisMonth,
        totalInvested,
        totalInvestmentValue,
        totalReturns
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
    const { name, assetType, targetAmount, targetDate, color, type, currentValue } = req.body;

    const update = { name, targetAmount, targetDate, color, ...pickSipFields(req.body) };
    if (type === "goal" || type === "investment") update.type = type;
    if (assetType !== undefined) update.assetType = assetType;
    if (currentValue !== undefined) update.currentValue = Number(currentValue) || 0;
    if (req.body.heldInAccountId !== undefined) update.heldInAccountId = req.body.heldInAccountId || null;

    const goal = await SavingsGoal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      update,
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
 * Update an investment's current market value (no money moves — this just
 * reflects gains/losses). Returns are recomputed against the invested amount.
 * PATCH /api/savings-goals/:id/value
 */
export const updateGoalValue = async (req, res) => {
  try {
    const { currentValue } = req.body;
    if (currentValue === undefined || Number(currentValue) < 0) {
      return res.status(400).json({ success: false, message: "A valid current value is required" });
    }

    const goal = await SavingsGoal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { currentValue: Number(currentValue) },
      { new: true }
    );

    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    res.json({ success: true, data: goal });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating value", error: error.message });
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

    // Also delete all contributions and the savings/withdrawal transactions
    // that were created for this goal, so nothing is left orphaned.
    await Contribution.deleteMany({ savingsGoalId: req.params.id });
    await Transaction.deleteMany({ userId: req.user.id, savingsGoalId: req.params.id });

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

    // Investment → real money leaves the chosen account to buy the asset (a
    // one-sided transfer). Goal → the money stays put; we just reserve more of
    // its held-in account (no transaction, no balance change).
    let transaction = null;
    if (goal.type === "investment") {
      const srcAccountId = await resolveAccountId(req.user.id, req.body.accountId);
      transaction = await Transaction.create({
        userId: req.user.id,
        type: "transfer",
        amount,
        name: goal.name,
        category: "Investment",
        note: note || `Contribution to ${goal.name}`,
        date: date || new Date(),
        accountId: srcAccountId,
        savingsGoalId: goalId
      });
      goal.currentValue = Number(goal.currentValue) + Number(amount);
    }

    // Reserve more toward the goal (or record the invested amount).
    goal.savedAmount = Number(goal.savedAmount) + Number(amount);

    // Auto-complete a target goal once it's reached.
    if (goal.type === "goal" && goal.targetAmount > 0 && goal.savedAmount >= goal.targetAmount) {
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

    const when = date || new Date();

    // Investment → redeeming brings real money back INTO the chosen account (a
    // one-sided transfer). Goal → just release the reservation (no money moves;
    // it was already sitting in the held-in account).
    let transaction = null;
    if (goal.type === "investment") {
      const destAccountId = await resolveAccountId(req.user.id, req.body.accountId);
      transaction = await Transaction.create({
        userId: req.user.id,
        type: "transfer",
        amount,
        name: goal.name,
        category: "Investment",
        note: note || `Withdrawal from ${goal.name}`,
        date: when,
        toAccountId: destAccountId,
        savingsGoalId: goalId
      });
      goal.currentValue = Math.max(0, Number(goal.currentValue) - Number(amount));
    }

    goal.savedAmount = Math.max(0, Number(goal.savedAmount) - Number(amount));
    await goal.save();

    res.status(201).json({
      success: true,
      data: { goal, contribution, transaction }
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