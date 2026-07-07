import mongoose from "mongoose";

/**
 * A ScheduledPayment (a "bill") is a future obligation with a due date and a
 * paid/unpaid lifecycle. It covers two real-life cases:
 *   - a one-off future payment (recurrence "none"), e.g. insurance in 3 months
 *   - a repeating bill (rent, electricity, subscriptions)
 *
 * Two modes:
 *   - "reminder"  → nothing posts automatically; the user marks it paid and
 *                   enters the ACTUAL amount (ideal for variable bills like
 *                   electricity). This is the default.
 *   - "auto_post" → the expense is generated automatically on the due date
 *                   (for fixed bills someone wants hands-off).
 *
 * When a bill is paid (manually or auto), a normal transaction is created so it
 * flows into balances/budgets/reports like any other expense/income. Recurring
 * bills advance their dueDate; one-off bills are marked paid.
 */
const scheduledPaymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["expense", "income"], default: "expense" },
    category: { type: String, default: "Bills" },
    amount: { type: Number, required: true }, // expected amount

    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    // When set, this bill is a credit-card statement. Paying it transfers money
    // from a bank account INTO this card (reducing its outstanding), rather than
    // creating an expense (the card spends were already expenses).
    sourceCardId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },

    dueDate: { type: Date, required: true }, // next due date
    recurrence: {
      type: String,
      enum: ["none", "daily", "weekly", "monthly", "yearly"],
      default: "none",
    },
    interval: { type: Number, default: 1 }, // every N periods
    endDate: { type: Date, default: null }, // stop repeating after this date

    mode: { type: String, enum: ["reminder", "auto_post"], default: "reminder" },

    isActive: { type: Boolean, default: true }, // pause a recurring bill
    isPaid: { type: Boolean, default: false }, // one-off: settled or not
    lastPaidDate: { type: Date, default: null },

    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("ScheduledPayment", scheduledPaymentSchema);
