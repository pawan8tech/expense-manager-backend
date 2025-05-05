const asyncHandler = require("express-async-handler");
const Expense = require("../models/expenseModel");

const getExpenses = asyncHandler(async (req, res) => {
  const expenses = await Expense.find({ user_id: req.user.id });
  res.status(200).json({ message: "hii", data: expenses });
});

const getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.find({ type: req.params.type });
  if (!expense) {
    res.status(400);
    throw new Error("Expense not found");
  }
  res.status(200).json({ data: expense, message: `${req.params.type}` });
});

const updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.type);
  if (!expense) {
    res.status(400);
    throw new Error("Expense not found");
  }
  console.log(expense.user_id);
  if (expense.user_id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("User dont have permission to update other user contacts");
  }
  const updatedExpense = await Expense.findByIdAndUpdate(
    { type: req.params.type },
    req.body,
    { new: true }
  );
  res.status(200).json({ message: "Updated  Expense", data: updatedExpense });
});

const addExpense = asyncHandler(async (req, res) => {
  const { name, date, type, amount } = req.body;
  if (!name || !type || !amount) {
    res.status(400);
    throw new Error("All Fields are Mandatory");
  }
  const expenses = await Expense.create({
    name,
    date,
    type,
    amount,
    user_id: req.user.id,
  });
  res.status(200).json(expenses);
});

const deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.find({ type: req.params.type });
  if (!expense) {
    res.status(400);
    throw new Error("Expense not found");
  }
  await Expense.removeAllListeners();
  res
    .status(200)
    .json({ message: "Expense deleted successfully", data: expense });
});

module.exports = {
  addExpense,
  deleteExpense,
  getExpenses,
  getExpense,
  updateExpense,
};
