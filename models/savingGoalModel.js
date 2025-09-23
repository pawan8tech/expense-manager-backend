// models/SavingsGoal.js
import mongoose from "mongoose";

const savingsGoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },           // e.g., Laptop
  category: { type: String, default: "Savings" },  // can be user defined
  targetAmount: { type: Number, required: true },
  savedAmount: { type: Number, default: 0 },
  contributionAmount : { type: Number, default: 0 },     // updated by contributions/utilizations
  startDate: { type: Date, default: Date.now },
  targetDate: { type: Date },                       // optional
  status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" }
}, { timestamps: true });

export default mongoose.model("SavingsGoal", savingsGoalSchema);
