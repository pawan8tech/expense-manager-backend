// src/controllers/recurringController.js
import RecurringRule from "../models/recurringModel.js";
import Transaction from "../models/transactionModel.js";

// Fields whose changes should sync to the materialized transactions.
const VALUE_FIELDS = ["name", "type", "amount", "category", "note"];
// Fields that change when/which transactions exist. Editing these means we
// have to throw out previously generated transactions and rebuild.
const SCHEDULE_FIELDS = ["frequency", "interval", "startDate", "endDate"];
// Anything else a client may send (everything that can be edited).
const EDITABLE_FIELDS = [
  ...VALUE_FIELDS,
  ...SCHEDULE_FIELDS,
  "isActive",
];

const pickEditable = (body = {}) => {
  const out = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

const sameDate = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
};

// helper to calculate next date
const getNextDate = (date, frequency, interval) => {
  const d = new Date(date);
  if (frequency === "daily") d.setDate(d.getDate() + interval);
  if (frequency === "weekly") d.setDate(d.getDate() + 7 * interval);
  if (frequency === "monthly") d.setMonth(d.getMonth() + interval);
  if (frequency === "yearly") d.setFullYear(d.getFullYear() + interval);
  return d;
};

// First scheduled date on/after `target`, starting from a known point on
// the schedule (lastGenerated or startDate). Used when resuming a paused
// rule so we don't suddenly materialize a backlog of missed occurrences.
const advanceScheduleTo = (rule, target) => {
  let d = rule.lastGenerated
    ? new Date(rule.lastGenerated)
    : new Date(rule.startDate);
  while (d < target) {
    d = getNextDate(d, rule.frequency, rule.interval);
  }
  return d;
};

// Generate due transactions from recurring rules (called before reads on the
// dashboard / transactions endpoints).
export const generateDueTransactions = async (userId) => {
  const rules = await RecurringRule.find({ userId, isActive: true });

  for (const rule of rules) {
    let nextDate = rule.lastGenerated
      ? new Date(rule.lastGenerated)
      : new Date(rule.startDate);
    const today = new Date();
    let advanced = false;

    while (nextDate <= today && (!rule.endDate || nextDate <= rule.endDate)) {
      const exists = await Transaction.findOne({
        userId,
        recurringId: rule._id,
        date: nextDate,
      });
      if (!exists) {
        await Transaction.create({
          userId,
          name: rule.name,
          type: rule.type,
          amount: rule.amount,
          category: rule.category,
          note: rule.note,
          date: nextDate,
          isRecurring: true,
          recurringId: rule._id,
        });
      }
      nextDate = getNextDate(nextDate, rule.frequency, rule.interval);
      advanced = true;
    }

    if (advanced) {
      rule.lastGenerated = nextDate;
      await rule.save();
    }
  }
};

// CRUD recurring rules
export const addRecurring = async (req, res) => {
  try {
    const payload = pickEditable(req.body);
    const rule = await RecurringRule.create({
      ...payload,
      userId: req.user.id,
    });
    // Materialize anything that's already due, so the transaction list
    // reflects this new rule immediately.
    await generateDueTransactions(req.user.id);
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecurring = async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = { userId: req.user.id };
    if (type && type !== "all") filter.type = type;

    const totalCount = await RecurringRule.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limitNum);

    const rules = await RecurringRule.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const incomeCount = await RecurringRule.countDocuments({
      userId: req.user.id,
      type: "income",
    });
    const expenseCount = await RecurringRule.countDocuments({
      userId: req.user.id,
      type: "expense",
    });

    res.json({
      success: true,
      data: rules,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      counts: {
        all: totalCount,
        income: incomeCount,
        expense: expenseCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get one recurring rule
export const getRecurringById = async (req, res) => {
  try {
    const rule = await RecurringRule.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Recurring rule not found" });
    }

    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update a recurring rule and keep its materialized transactions consistent.
 *
 *  - Value-only edits (name/amount/category/note/type/isActive) are copied to
 *    every transaction that was generated from this rule, so a "wrong amount"
 *    fix updates the existing rows on the transaction list.
 *  - Schedule edits (frequency/interval/startDate/endDate) invalidate the
 *    materialized history: we delete every transaction this rule generated,
 *    reset `lastGenerated`, and regenerate from the new schedule. This fixes
 *    the "I added a wrong date and now the wrong dates are stuck on the
 *    transaction table" case.
 */
export const updateRecurring = async (req, res) => {
  try {
    const existing = await RecurringRule.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Recurring rule not found" });
    }

    const updates = pickEditable(req.body);

    const scheduleChanged = SCHEDULE_FIELDS.some((field) => {
      if (!(field in updates)) return false;
      if (field === "startDate" || field === "endDate") {
        return !sameDate(existing[field], updates[field]);
      }
      return existing[field] !== updates[field];
    });

    Object.assign(existing, updates);

    if (scheduleChanged) {
      // Throw away old auto-generated history; we'll rebuild from the new
      // schedule below.
      await Transaction.deleteMany({
        userId: req.user.id,
        recurringId: existing._id,
      });
      existing.lastGenerated = null;
    }

    await existing.save();

    if (!scheduleChanged) {
      // Push the new values onto every materialized transaction so the user
      // sees their correction reflected immediately.
      const txUpdates = {};
      for (const field of VALUE_FIELDS) {
        if (field in updates) txUpdates[field] = updates[field];
      }
      if (Object.keys(txUpdates).length > 0) {
        await Transaction.updateMany(
          { userId: req.user.id, recurringId: existing._id },
          { $set: txUpdates }
        );
      }
    } else {
      await generateDueTransactions(req.user.id);
    }

    res.status(200).json({ success: true, data: existing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Pause a recurring rule. Stops materialization until resumed. Existing
 * transactions are left alone.
 */
export const pauseRecurring = async (req, res) => {
  try {
    const rule = await RecurringRule.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Recurring rule not found" });
    }
    if (!rule.isActive) {
      return res.status(200).json({ success: true, data: rule });
    }
    rule.isActive = false;
    rule.pausedAt = new Date();
    await rule.save();
    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Resume a paused recurring rule. We deliberately skip catch-up generation
 * for the paused window: `lastGenerated` is advanced to the first scheduled
 * date on/after today so the user isn't surprised by a backlog appearing.
 * From there, normal generation takes over.
 */
export const resumeRecurring = async (req, res) => {
  try {
    const rule = await RecurringRule.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Recurring rule not found" });
    }
    if (rule.isActive) {
      return res.status(200).json({ success: true, data: rule });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    rule.isActive = true;
    rule.pausedAt = null;
    rule.lastGenerated = advanceScheduleTo(rule, today);
    await rule.save();

    // Materialize today's instance if the schedule lands on today.
    await generateDueTransactions(req.user.id);

    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a recurring rule.
 *
 * Modes (?mode=...):
 *   - "keep" (default): the rule is deleted but its materialized historical
 *     transactions stay. They're unlinked (isRecurring=false,
 *     recurringId=null) so the rows no longer show the recurring badge.
 *     Use this when the user just wants to stop the schedule but keep the
 *     financial record of what already happened.
 *   - "permanent": the rule AND every transaction it generated are
 *     deleted. Use this when the recurring was set up by mistake and the
 *     past transactions should be cleared too.
 */
export const deleteRecurring = async (req, res) => {
  try {
    const mode = req.query.mode === "permanent" ? "permanent" : "keep";

    const rule = await RecurringRule.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!rule) {
      return res
        .status(404)
        .json({ success: false, message: "Recurring rule not found" });
    }

    let removedCount = 0;
    if (mode === "permanent") {
      const result = await Transaction.deleteMany({
        userId: req.user.id,
        recurringId: rule._id,
      });
      removedCount = result.deletedCount || 0;
    } else {
      await Transaction.updateMany(
        { userId: req.user.id, recurringId: rule._id },
        { $set: { isRecurring: false, recurringId: null } }
      );
    }

    res.status(200).json({
      success: true,
      mode,
      removedCount,
      message:
        mode === "permanent"
          ? `Recurring rule and ${removedCount} generated transaction(s) deleted`
          : "Recurring rule deleted — past transactions kept as history",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
