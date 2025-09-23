// models/Budget.js
import mongoose from "mongoose";

const CategoryBudgetSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true, // e.g. "Food", "Transport"
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
});

const BudgetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true, // e.g. "September Budget"
    },
    totalBudget: {
      type: Number,
      required: true,
      min: 0,
    },
    categories: [CategoryBudgetSchema],
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Budget", BudgetSchema);
