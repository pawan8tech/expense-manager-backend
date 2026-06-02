import asyncHandler from "express-async-handler";
import Category from "../models/categoryModel.js";
import Transaction from "../models/transactionModel.js";
import Budget from "../models/budgetModel.js";
import RecurringRule from "../models/recurringModel.js";
import SavingsGoal from "../models/savingGoalModel.js";
import {
  defaultExpenseCategories,
  defaultIncomeCategories,
} from "../constants/defaultCategories.js";

const DEFAULT_NAMES = new Set([
  ...defaultExpenseCategories,
  ...defaultIncomeCategories,
]);

/**
 * Count everywhere a category name is referenced. Categories are linked by
 * NAME (not id) across the app, so deleting the Category row doesn't touch
 * these records — they'd just keep the old name. We surface the breakdown so
 * the client can warn the user (or offer "Hide" instead) before deleting.
 */
const countCategoryUsage = async (userId, name) => {
  const [transactions, budgets, recurring, savings] = await Promise.all([
    Transaction.countDocuments({ userId, category: name }),
    Budget.countDocuments({ userId, "categories.category": name }),
    RecurringRule.countDocuments({ userId, category: name }),
    SavingsGoal.countDocuments({ userId, category: name }),
  ]);
  const total = transactions + budgets + recurring + savings;
  return { transactions, budgets, recurring, savings, total };
};

/**
 * Seed defaults for a user that has none yet, then return all categories.
 * Listing is a natural moment to seed because every other surface in the
 * app fetches the list before showing pickers.
 *
 * Also backfills `isSystem` on any category whose name matches a default —
 * keeps legacy rows that were seeded before the flag existed protected.
 */
export const listCategories = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const count = await Category.countDocuments({ userId });

  if (count === 0) {
    const seeds = [
      ...defaultExpenseCategories.map((name) => ({
        userId,
        name,
        type: "expense",
        isSystem: true,
      })),
      ...defaultIncomeCategories.map((name) => ({
        userId,
        name,
        type: "income",
        isSystem: true,
      })),
    ];
    try {
      await Category.insertMany(seeds, { ordered: false });
    } catch (err) {
      // ignore duplicate-key errors (race conditions on first load)
    }
  } else {
    // Backfill isSystem for legacy seeded rows.
    await Category.updateMany(
      {
        userId,
        isSystem: { $ne: true },
        name: { $in: Array.from(DEFAULT_NAMES) },
      },
      { $set: { isSystem: true } }
    );
  }

  const categories = await Category.find({ userId }).sort({ type: 1, name: 1 });
  return res.status(200).json({ success: true, data: categories });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, type } = req.body;
  const trimmed = (name || "").trim();

  if (!trimmed) {
    return res.status(400).json({ message: "Name is required" });
  }
  if (!["income", "expense"].includes(type)) {
    return res
      .status(400)
      .json({ message: "Type must be 'income' or 'expense'" });
  }
  if (trimmed.length > 60) {
    return res
      .status(400)
      .json({ message: "Name must be 60 characters or fewer" });
  }

  const existing = await Category.findOne({
    userId: req.user.id,
    type,
    name: { $regex: `^${trimmed}$`, $options: "i" },
  });
  if (existing) {
    return res
      .status(409)
      .json({ message: `'${trimmed}' already exists for ${type}` });
  }

  const created = await Category.create({
    userId: req.user.id,
    name: trimmed,
    type,
    isSystem: false,
    hidden: false,
  });
  return res.status(201).json({ success: true, data: created });
});

/**
 * Patch a category. Only `hidden` is editable today — name/type changes
 * could orphan historical transactions, so they're not exposed.
 *
 * System categories CAN be hidden (the point of hide is to curate the
 * picker without losing the record) but cannot be renamed or retyped.
 */
export const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { hidden } = req.body;

  const category = await Category.findOne({ _id: id, userId: req.user.id });
  if (!category) {
    return res.status(404).json({ message: "Category not found" });
  }

  if (typeof hidden === "boolean") {
    category.hidden = hidden;
  }
  await category.save();
  return res.status(200).json({ success: true, data: category });
});

/**
 * Report where a category is referenced (transactions, budgets, recurring
 * rules, savings goals) so the client can warn the user before deleting.
 * Read-only — never mutates.
 */
export const getCategoryUsage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const category = await Category.findOne({ _id: id, userId: req.user.id });
  if (!category) {
    return res.status(404).json({ message: "Category not found" });
  }

  const usage = await countCategoryUsage(req.user.id, category.name);
  return res.status(200).json({
    success: true,
    data: { id, name: category.name, isSystem: !!category.isSystem, ...usage },
  });
});

/**
 * Bulk-reassign every record that references this category to another
 * category (same type), then delete the source. Because records link by
 * NAME, "reassigning" is a name rewrite across transactions, recurring
 * rules, savings goals and budget line-items — done in one shot, not row by
 * row. This is the clean alternative to leaving orphaned name references
 * behind when a category is in use.
 */
export const reassignCategory = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { targetId } = req.body;

  const source = await Category.findOne({ _id: id, userId });
  if (!source) {
    return res.status(404).json({ message: "Category not found" });
  }
  if (source.isSystem) {
    return res.status(403).json({
      message: "Default categories can't be deleted — hide it instead.",
    });
  }

  const target = await Category.findOne({ _id: targetId, userId });
  if (!target) {
    return res.status(404).json({ message: "Target category not found" });
  }
  if (String(target._id) === String(source._id)) {
    return res
      .status(400)
      .json({ message: "Pick a different category to move to." });
  }
  if (target.type !== source.type) {
    return res
      .status(400)
      .json({ message: "Can only move to a category of the same type." });
  }

  const [tx, rec, sav] = await Promise.all([
    Transaction.updateMany(
      { userId, category: source.name },
      { $set: { category: target.name } }
    ),
    RecurringRule.updateMany(
      { userId, category: source.name },
      { $set: { category: target.name } }
    ),
    SavingsGoal.updateMany(
      { userId, category: source.name },
      { $set: { category: target.name } }
    ),
  ]);

  // Budgets need a per-document merge, not a blind rename: if a budget already
  // has a line-item for the target category, fold the source's planned amount
  // into it (matching how its transactions now combine) instead of leaving two
  // line-items with the same name.
  const affectedBudgets = await Budget.find({
    userId,
    "categories.category": source.name,
  });
  for (const budget of affectedBudgets) {
    const sourceAmount = budget.categories
      .filter((c) => c.category === source.name)
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    // Drop every source line-item.
    budget.categories = budget.categories.filter(
      (c) => c.category !== source.name
    );

    const existingTarget = budget.categories.find(
      (c) => c.category === target.name
    );
    if (existingTarget) {
      existingTarget.amount = (existingTarget.amount || 0) + sourceAmount;
    } else {
      budget.categories.push({ category: target.name, amount: sourceAmount });
    }
    await budget.save();
  }

  await source.deleteOne();

  const moved = {
    transactions: tx.modifiedCount || 0,
    recurring: rec.modifiedCount || 0,
    savings: sav.modifiedCount || 0,
    budgets: affectedBudgets.length,
  };
  moved.total =
    moved.transactions + moved.recurring + moved.savings + moved.budgets;

  return res.status(200).json({
    success: true,
    data: { id, targetId, targetName: target.name, moved },
    message: `Moved ${moved.total} record(s) to '${target.name}' and deleted '${source.name}'.`,
  });
});

/**
 * Delete a category. System categories (seeded defaults) cannot be deleted
 * — the client should offer "Hide" instead. Custom user categories can be
 * removed entirely.
 *
 * If the category is referenced anywhere, the delete is refused with 409
 * unless the caller passes `?force=true` (the client confirms intent first).
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === "true";
  const category = await Category.findOne({ _id: id, userId: req.user.id });
  if (!category) {
    return res.status(404).json({ message: "Category not found" });
  }

  if (category.isSystem) {
    return res.status(403).json({
      message:
        "Default categories can't be deleted — hide it instead if you don't use it.",
    });
  }

  const usage = await countCategoryUsage(req.user.id, category.name);

  if (usage.total > 0 && !force) {
    return res.status(409).json({
      message: `'${category.name}' is still in use. Confirm to delete anyway.`,
      data: { id, name: category.name, inUse: usage.total, usage },
    });
  }

  await category.deleteOne();
  return res.status(200).json({
    success: true,
    data: { id, inUse: usage.total, usage },
    message:
      usage.total > 0
        ? `Deleted. ${usage.total} existing record(s) still reference this category.`
        : "Category deleted",
  });
});
