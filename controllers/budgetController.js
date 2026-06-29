// controllers/budgetController.js
import Budget from "../models/budgetModel.js";
import transactionModel from "../models/transactionModel.js";

// -------------------- Duplicate-period helpers -------------------- //
// Compare two dates by calendar day in UTC (dates are stored as UTC midnight
// of the chosen "YYYY-MM-DD"), so time components never cause false misses.
const sameCalendarDay = (a, b) => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
};

const isFullCalendarMonth = (s, e) => {
  const ds = new Date(s);
  const de = new Date(e);
  const lastDay = new Date(Date.UTC(ds.getUTCFullYear(), ds.getUTCMonth() + 1, 0)).getUTCDate();
  return (
    ds.getUTCDate() === 1 &&
    de.getUTCDate() === lastDay &&
    ds.getUTCMonth() === de.getUTCMonth() &&
    ds.getUTCFullYear() === de.getUTCFullYear()
  );
};

const isFullCalendarYear = (s, e) => {
  const ds = new Date(s);
  const de = new Date(e);
  return (
    ds.getUTCMonth() === 0 && ds.getUTCDate() === 1 &&
    de.getUTCMonth() === 11 && de.getUTCDate() === 31 &&
    ds.getUTCFullYear() === de.getUTCFullYear()
  );
};

const duplicatePeriodMessage = (s, e) => {
  if (isFullCalendarYear(s, e)) return "You already have a budget for this year";
  if (isFullCalendarMonth(s, e)) return "You already have a budget for this month";
  return "You already have a budget for this period";
};

// -------------------- Input sanitizing / validation -------------------- //
// Only these fields may be written by the client. Anything else (userId, _id,
// timestamps, injected flags) is dropped so a payload can't reassign ownership
// or corrupt server-managed fields.
const BUDGET_EDITABLE_FIELDS = ["name", "totalBudget", "categories", "startDate", "endDate"];

const pickBudgetFields = (body = {}) => {
  const out = {};
  for (const key of BUDGET_EDITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

// Returns an error string if the payload is invalid, otherwise null. Normalizes
// category amounts to numbers so the category-sum check can't be fooled by
// undefined/NaN values slipping through.
const validateBudgetPayload = (fields, { requireAll = false } = {}) => {
  const { name, totalBudget, categories, startDate, endDate } = fields;

  if (requireAll) {
    if (!name || !String(name).trim()) return "Budget name is required";
    if (totalBudget === undefined) return "Total budget is required";
    if (!startDate || !endDate) return "Start and end dates are required";
  }

  if (totalBudget !== undefined && (!Number.isFinite(Number(totalBudget)) || Number(totalBudget) < 0)) {
    return "Total budget must be a positive number";
  }

  if (categories !== undefined) {
    if (!Array.isArray(categories)) return "Categories must be a list";
    for (const c of categories) {
      if (!c || !c.category || !String(c.category).trim()) return "Each category needs a name";
      const amt = Number(c.amount);
      if (!Number.isFinite(amt) || amt < 0) return `Invalid amount for category "${c.category}"`;
    }
    const categorySum = categories.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    if (totalBudget !== undefined && categorySum > Number(totalBudget)) {
      return "Sum of category budgets cannot exceed total budget";
    }
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return "Start date must be before end date";
  }

  return null;
};

// Find an existing budget for the user covering the exact same calendar range
// (same month / same year). Monthly and yearly budgets have distinct ranges,
// so they never collide with each other. `excludeId` skips the budget being
// updated so it isn't flagged as a duplicate of itself.
const findDuplicatePeriodBudget = async (userId, startDate, endDate, excludeId = null) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  // Narrow to budgets whose range overlaps the new one, then require an
  // exact day-for-day match on both ends.
  const candidates = await Budget.find({
    userId,
    startDate: { $lte: end },
    endDate: { $gte: start },
  });
  return candidates.find(
    (b) =>
      (!excludeId || String(b._id) !== String(excludeId)) &&
      sameCalendarDay(b.startDate, start) &&
      sameCalendarDay(b.endDate, end)
  );
};

// Add Budget
export const addBudget = async (req, res) => {
  try {
    const userId = req.user.id; // Get userId from JWT token
    const fields = pickBudgetFields(req.body);

    const validationError = validateBudgetPayload(fields, { requireAll: true });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    // Block a second budget for the same month / year.
    const duplicate = await findDuplicatePeriodBudget(userId, fields.startDate, fields.endDate);
    if (duplicate) {
      return res.status(409).json({ message: duplicatePeriodMessage(fields.startDate, fields.endDate) });
    }

    const newBudget = new Budget({ userId, ...fields });

    await newBudget.save();
    res.status(201).json({ success: true, data: newBudget });
  } catch (error) {
    res.status(500).json({ message: "Error adding budget", error: error.message });
  }
};

// Get budgets (current month or specific month)
export const getBudgets = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id; // Get userId from JWT token

    // Find budgets for that month (assuming your budget has startDate/endDate fields)
    const budgets = await Budget.find({
      userId,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    });

    const results = [];

    // Fetch every relevant transaction ONCE across the union of all budget
    // periods, then bucket per budget in memory. Avoids an N+1 query per
    // budget. Planned/future event spends are excluded — they aren't real
    // spending yet and would inflate the budget's used amount.
    let allTransactions = [];
    if (budgets.length > 0) {
      const minStart = budgets.reduce(
        (m, b) => (b.startDate < m ? b.startDate : m),
        budgets[0].startDate
      );
      const maxEnd = budgets.reduce(
        (m, b) => (b.endDate > m ? b.endDate : m),
        budgets[0].endDate
      );
      allTransactions = await transactionModel.find({
        userId,
        isPlanned: { $ne: true },
        type: "expense",
        date: { $gte: minStart, $lte: maxEnd },
      });
    }

    for (const budget of budgets) {
      // Transactions that fall inside this budget's window (budgets can
      // overlap, e.g. a monthly budget within a yearly one).
      const transactions = allTransactions.filter(
        (t) => t.date >= budget.startDate && t.date <= budget.endDate
      );

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
    const userId = req.user.id; // Get userId from JWT token
    const fields = pickBudgetFields(req.body);

    // For a category-sum check on a partial update we need the existing
    // totalBudget when the client didn't resend it.
    const existing = await Budget.findOne({ _id: req.params.id, userId });
    if (!existing) return res.status(404).json({ message: "Budget not found" });

    const merged = {
      totalBudget: fields.totalBudget !== undefined ? fields.totalBudget : existing.totalBudget,
      categories: fields.categories !== undefined ? fields.categories : existing.categories,
      startDate: fields.startDate || existing.startDate,
      endDate: fields.endDate || existing.endDate,
      name: fields.name !== undefined ? fields.name : existing.name,
    };

    const validationError = validateBudgetPayload(merged);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    // If the period changed, block colliding with another month/year budget
    // (excluding this one).
    if (fields.startDate && fields.endDate) {
      const duplicate = await findDuplicatePeriodBudget(userId, fields.startDate, fields.endDate, req.params.id);
      if (duplicate) {
        return res.status(409).json({ message: duplicatePeriodMessage(fields.startDate, fields.endDate) });
      }
    }

    // Only the whitelisted fields are written — never the raw body.
    const updated = await Budget.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: fields },
      { new: true, runValidators: true }
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ message: "Error updating budget", error: error.message });
  }
};

// Delete Budget
export const deleteBudget = async (req, res) => {
  try {
    const userId = req.user.id; // Get userId from JWT token
    
    // Only delete budget if it belongs to the user
    const deleted = await Budget.findOneAndDelete({ 
      _id: req.params.id, 
      userId 
    });
    
    if (!deleted) return res.status(404).json({ message: "Budget not found" });
    res.json({ success: true, message: "Budget deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting budget", error: error.message });
  }
};
