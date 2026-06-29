import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["income", "expense","saving"], required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  note: { type: String },
  date: { type: Date, default: Date.now },

  // Recurring fields
  isRecurring: { type: Boolean, default: false },
  recurringId: { type: mongoose.Schema.Types.ObjectId, ref: "RecurringRule", default: null },

  // Savings link — set when this transaction is a contribution to / withdrawal
  // from a savings goal, so goal activity stays traceable.
  savingsGoalId: { type: mongoose.Schema.Types.ObjectId, ref: "SavingsGoal", default: null },

  // Event planning fields
  // When set, this transaction belongs to a big event (marriage, vacation, …).
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
  // A planned/future spend counts toward the event plan but is excluded from
  // the user's current balance and the main transaction list until confirmed.
  isPlanned: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model("Transaction", transactionSchema);
