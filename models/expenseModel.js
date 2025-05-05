const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
  name: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  type: {
    type: String,
    required: true,
    enum: ["Food", "Travel", "Shopping", "Health", "Utilities", "Other"],
  },
});

const Expense = mongoose.model("Expense", expenseSchema);

module.exports = Expense;
