import asyncHandler from "express-async-handler";
import Category from "../models/categoryModel.js";
import Transaction from "../models/transactionModel.js";
import {
  defaultExpenseCategories,
  defaultIncomeCategories,
} from "../constants/defaultCategories.js";

const DEFAULT_NAMES = new Set([
  ...defaultExpenseCategories,
  ...defaultIncomeCategories,
]);

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
 * Delete a category. System categories (seeded defaults) cannot be deleted
 * — the client should offer "Hide" instead. Custom user categories can be
 * removed entirely.
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
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

  const inUse = await Transaction.countDocuments({
    userId: req.user.id,
    category: category.name,
  });

  await category.deleteOne();
  return res.status(200).json({
    success: true,
    data: { id, inUse },
    message:
      inUse > 0
        ? `Deleted. ${inUse} existing transaction(s) still reference this category.`
        : "Category deleted",
  });
});
