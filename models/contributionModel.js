/**
 * Contribution Model
 * 
 * Tracks individual contribution records for savings goals.
 * Each contribution is linked to a specific savings goal.
 */
import mongoose from "mongoose";

const contributionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  savingsGoalId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "SavingsGoal", 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true,
    min: [1, "Contribution amount must be positive"]
  },
  type: { 
    type: String, 
    enum: ["deposit", "withdrawal"], 
    default: "deposit" 
  },
  note: { 
    type: String,
    default: ""
  },
  date: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

// Index for efficient queries
contributionSchema.index({ savingsGoalId: 1, date: -1 });
contributionSchema.index({ userId: 1, date: -1 });

export default mongoose.model("Contribution", contributionSchema);
