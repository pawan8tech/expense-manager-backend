import mongoose from "mongoose";

/**
 * A Debt is an EMI/interest SCHEDULE layered on top of a "loan" liability
 * account. The account (via computeAccountBalances) is the source of truth for
 * the outstanding balance; this record just holds the repayment metadata:
 * principal, interest rate, EMI amount, cadence and the next due date.
 *
 * - Disbursement is a transfer from the loan account → an asset account (or the
 *   loan account simply opens with a negative balance = amount owed).
 * - Each EMI splits into interest (a real expense) + principal (a transfer from
 *   an asset account → the loan account, reducing what's owed).
 */
const debtSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    lender: { type: String, trim: true, default: "" },

    // The liability account (type "loan") this schedule is attached to.
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },

    principal: { type: Number, required: true }, // original loan amount
    interestRate: { type: Number, default: 0 }, // annual %, for EMI interest split
    emiAmount: { type: Number, default: 0 },
    tenureMonths: { type: Number, default: 0 }, // informational

    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      default: "monthly",
    },
    startDate: { type: Date, default: Date.now },
    nextDueDate: { type: Date, default: null },
    lastPaidDate: { type: Date, default: null },

    status: { type: String, enum: ["active", "closed"], default: "active" },
  },
  { timestamps: true }
);

export default mongoose.model("Debt", debtSchema);
