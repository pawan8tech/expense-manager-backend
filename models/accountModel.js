import mongoose from "mongoose";

/**
 * An Account is a "pocket" money lives in: cash-in-hand, a bank account, a
 * wallet/UPI balance, or a credit card. Every transaction references the
 * account it affected, so balances become per-account instead of one global
 * `income − expense − saving`.
 *
 * Asset vs liability is DERIVED from `type` (credit_card = liability), so there
 * is one rule and no stored flag to keep in sync. Balances themselves are never
 * stored — they are computed from openingBalance + the account's transactions.
 */
const accountSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      // "loan" accounts back a Debt schedule (Phase 2). They are liabilities
      // like credit cards but are managed from the Debts page, not here.
      enum: ["cash", "bank", "wallet", "credit_card", "loan"],
      required: true,
    },

    // Balance at the moment the account was added to the app. Computed balance
    // = openingBalance + signed sum of this account's transactions.
    openingBalance: { type: Number, default: 0 },

    // Credit cards only — used to show available credit (limit − outstanding).
    creditLimit: { type: Number, default: 0 },

    // Credit-card billing cycle (day-of-month). When statementDay is set, the
    // app auto-generates a bill for the outstanding on each statement date,
    // due on the next dueDay. lastStatementDate guards against duplicates.
    statementDay: { type: Number, default: null },
    dueDay: { type: Number, default: null },
    lastStatementDate: { type: Date, default: null },

    // UI presentation (light theme, bold modern design system).
    color: { type: String, default: "#6366f1" },
    icon: { type: String, default: "Wallet" },

    // The account preselected in transaction/transfer forms.
    isDefault: { type: Boolean, default: false },

    // Archived accounts are hidden from pickers but keep their history.
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Credit cards and loans are liabilities (balance owed, not money you hold).
accountSchema.virtual("isLiability").get(function () {
  return this.type === "credit_card" || this.type === "loan";
});

export default mongoose.model("Account", accountSchema);
