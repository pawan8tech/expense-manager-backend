/**
 * SavingsGoal Model
 * 
 * Tracks savings goals with target amounts and progress.
 * Individual contributions are stored in the Contribution model.
 */
import mongoose from "mongoose";

const savingsGoalSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  category: { 
    type: String, 
    default: "Savings" 
  },
  targetAmount: { 
    type: Number, 
    required: true,
    min: [1, "Target amount must be positive"]
  },
  savedAmount: { 
    type: Number, 
    default: 0 
  },
  startDate: { 
    type: Date, 
    default: Date.now 
  },
  targetDate: { 
    type: Date 
  },
  status: { 
    type: String, 
    enum: ["active", "completed", "cancelled"], 
    default: "active" 
  },
  color: {
    type: String,
    default: "#6366f1"  // Default purple color for UI
  }
}, { timestamps: true });

// Virtual to get contribution count (populated separately)
savingsGoalSchema.virtual("contributionCount", {
  ref: "Contribution",
  localField: "_id",
  foreignField: "savingsGoalId",
  count: true
});

// Calculate progress percentage
savingsGoalSchema.virtual("progress").get(function() {
  if (!this.targetAmount || this.targetAmount === 0) return 0;
  return Math.min(100, Math.round((this.savedAmount / this.targetAmount) * 100));
});

// Ensure virtuals are included in JSON
savingsGoalSchema.set("toJSON", { virtuals: true });
savingsGoalSchema.set("toObject", { virtuals: true });

export default mongoose.model("SavingsGoal", savingsGoalSchema);
