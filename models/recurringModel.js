// src/models/recurringModel.js
import mongoose from "mongoose";

const recurringSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["income", "expense"], required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  note: { type: String },

  frequency: { type: String, enum: ["daily", "weekly", "monthly", "yearly"], required: true },
  interval: { type: Number, default: 1 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null },

  lastGenerated: { type: Date, default: null }, 
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("RecurringRule", recurringSchema);
