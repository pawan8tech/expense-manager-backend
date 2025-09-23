// src/controllers/recurringController.js
import RecurringRule from "../models/recurringModel.js";
import Transaction from "../models/transactionModel.js";

// helper to calculate next date
const getNextDate = (date, frequency, interval) => {
  const d = new Date(date);
  if (frequency === "daily") d.setDate(d.getDate() + interval);
  if (frequency === "weekly") d.setDate(d.getDate() + 7 * interval);
  if (frequency === "monthly") d.setMonth(d.getMonth() + interval);
  if (frequency === "yearly") d.setFullYear(d.getFullYear() + interval);
  return d;
};

// generate due transactions from recurring rules
export const generateDueTransactions = async (userId) => {
  const rules = await RecurringRule.find({ userId, isActive: true });

  for (const rule of rules) {
    let nextDate = rule.lastGenerated || rule.startDate;
    const today = new Date();

    while (nextDate <= today && (!rule.endDate || nextDate <= rule.endDate)) {
      const exists = await Transaction.findOne({ userId, recurringId: rule._id, date: nextDate });
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
          recurringId: rule._id
        });
      }
      nextDate = getNextDate(nextDate, rule.frequency, rule.interval);
      rule.lastGenerated = nextDate;
      await rule.save();
    }
  }
};

// CRUD recurring rules
export const addRecurring = async (req, res) => {
  try {
    const rule = await RecurringRule.create({ userId: req.user.id, ...req.body });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecurring = async (req, res) => {
  const rules = await RecurringRule.find({ userId: req.user.id });
  res.json({ success: true, data: rules });
};

// ✅ Get one recurring rule
export const getRecurringById = async (req, res) => {
  try {
    const rule = await RecurringRule.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!rule) {
      return res.status(404).json({ success: false, message: "Recurring rule not found" });
    }

    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Update recurring rule
export const updateRecurring = async (req, res) => {
  try {
    const rule = await RecurringRule.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true }
    );

    if (!rule) {
      return res.status(404).json({ success: false, message: "Recurring rule not found" });
    }

    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Delete recurring rule
export const deleteRecurring = async (req, res) => {
  try {
    const rule = await RecurringRule.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!rule) {
      return res.status(404).json({ success: false, message: "Recurring rule not found" });
    }

    res.status(200).json({ success: true, message: "Recurring rule deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
