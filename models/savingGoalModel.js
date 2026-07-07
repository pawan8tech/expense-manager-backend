/**
 * SavingsGoal Model
 *
 * Represents two kinds of saving:
 *  - "goal"       — save toward a target (laptop, trip, emergency fund).
 *                   Progress = savedAmount / targetAmount.
 *  - "investment" — money put into something that changes value over time
 *                   (stocks, mutual funds, SIP, FD). `savedAmount` is the
 *                   amount invested; `currentValue` is the latest market value
 *                   the user records; returns = currentValue − savedAmount.
 *
 * Either kind can have an automatic recurring contribution (a "SIP"): a fixed
 * amount auto-added on a schedule, materialized lazily when goals are read.
 *
 * Individual contributions/withdrawals are stored in the Contribution model.
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
  // Kind of saving — drives the UI and how progress/returns are shown.
  type: {
    type: String,
    enum: ["goal", "investment"],
    default: "goal"
  },
  // Investments only — the kind of asset, for display and (later) portfolio
  // allocation. Goals don't use this (their name is enough).
  assetType: {
    type: String,
    enum: ["stocks", "mutual_fund", "sip", "fd", "gold", "other"],
    default: "other"
  },
  // Optional now — investments and open-ended savings need no target.
  targetAmount: {
    type: Number,
    min: [0, "Target amount cannot be negative"],
    default: 0
  },
  // For goals: amount saved. For investments: amount invested (cost basis).
  savedAmount: {
    type: Number,
    default: 0
  },
  // Goals only — the account the saved money is kept in (a reservation of that
  // account's balance). The money never leaves the account; the goal just
  // earmarks part of it. Investments don't use this (their money left into an
  // asset).
  heldInAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    default: null
  },
  // Investments only: latest market value the user records. Returns are
  // computed against savedAmount (the invested amount).
  currentValue: {
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
    default: "#6366f1"
  },

  // ---- SIP (automatic recurring contribution) ----
  sipEnabled: { type: Boolean, default: false },
  sipAmount: { type: Number, default: 0 },
  sipFrequency: {
    type: String,
    enum: ["daily", "weekly", "monthly", "yearly"],
    default: "monthly"
  },
  sipStartDate: { type: Date },
  // Last schedule date for which a SIP contribution was materialized.
  sipLastRun: { type: Date, default: null },
  // Account the SIP auto-deducts from (falls back to the default account).
  sipAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null }
}, { timestamps: true });

// Virtual to get contribution count (populated separately)
savingsGoalSchema.virtual("contributionCount", {
  ref: "Contribution",
  localField: "_id",
  foreignField: "savingsGoalId",
  count: true
});

// Goal progress percentage (target-based).
savingsGoalSchema.virtual("progress").get(function() {
  if (!this.targetAmount || this.targetAmount === 0) return 0;
  return Math.min(100, Math.round((this.savedAmount / this.targetAmount) * 100));
});

// Investment returns (absolute + percent), based on invested vs current value.
savingsGoalSchema.virtual("returns").get(function() {
  if (this.type !== "investment") return 0;
  return (this.currentValue || 0) - (this.savedAmount || 0);
});
savingsGoalSchema.virtual("returnPercent").get(function() {
  if (this.type !== "investment" || !this.savedAmount) return 0;
  return Math.round((((this.currentValue || 0) - this.savedAmount) / this.savedAmount) * 1000) / 10;
});

savingsGoalSchema.set("toJSON", { virtuals: true });
savingsGoalSchema.set("toObject", { virtuals: true });

export default mongoose.model("SavingsGoal", savingsGoalSchema);
