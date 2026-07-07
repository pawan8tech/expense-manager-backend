import mongoose from "mongoose";

/**
 * A Lending ledger tracks money you LENT to someone (a receivable — an asset)
 * or BORROWED from them (a payable — a liability). It's isolated like Events:
 * the individual moves are recorded as single-sided transfer transactions
 * (tagged with lendingId) so they affect real account balances but never count
 * as income/expense.
 *
 * The outstanding balance and history are DERIVED from those transactions:
 *   - "give"    = money leaving your account (accountId set)
 *   - "receive" = money entering your account (toAccountId set)
 *   - lent:     outstanding = givenOut − receivedBack   (they owe you)
 *   - borrowed: outstanding = receivedIn − paidBack     (you owe them)
 */
const lendingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    person: { type: String, required: true, trim: true },
    direction: { type: String, enum: ["lent", "borrowed"], required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: ["open", "settled"], default: "open" },
  },
  { timestamps: true }
);

export default mongoose.model("Lending", lendingSchema);
