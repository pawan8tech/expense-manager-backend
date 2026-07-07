import mongoose from "mongoose";
import Lending from "../models/lendingModel.js";
import Transaction from "../models/transactionModel.js";

/**
 * Compute every lending's outstanding balance (and the receivable/payable
 * rollups) from its tagged transactions.
 *
 *   givenOut   = Σ amount of lending transfers with accountId set (money out)
 *   receivedIn = Σ amount of lending transfers with toAccountId set (money in)
 *   lent:     outstanding = givenOut − receivedIn   (they still owe you)
 *   borrowed: outstanding = receivedIn − givenOut   (you still owe them)
 */
export const computeLendingBalances = async (userId) => {
  const oid = new mongoose.Types.ObjectId(userId);

  const [lendings, outAgg, inAgg] = await Promise.all([
    Lending.find({ userId: oid }).sort({ status: 1, updatedAt: -1 }),
    Transaction.aggregate([
      { $match: { userId: oid, lendingId: { $ne: null }, accountId: { $ne: null } } },
      { $group: { _id: "$lendingId", total: { $sum: "$amount" } } },
    ]),
    Transaction.aggregate([
      { $match: { userId: oid, lendingId: { $ne: null }, toAccountId: { $ne: null } } },
      { $group: { _id: "$lendingId", total: { $sum: "$amount" } } },
    ]),
  ]);

  const outMap = {};
  const inMap = {};
  for (const o of outAgg) outMap[String(o._id)] = o.total;
  for (const i of inAgg) inMap[String(i._id)] = i.total;

  let receivable = 0;
  let payable = 0;

  const enriched = lendings.map((l) => {
    const givenOut = outMap[String(l._id)] || 0;
    const receivedIn = inMap[String(l._id)] || 0;
    const isLent = l.direction === "lent";
    const outstanding = Math.max(isLent ? givenOut - receivedIn : receivedIn - givenOut, 0);
    const principal = isLent ? givenOut : receivedIn;
    const settledAmount = isLent ? receivedIn : givenOut;

    if (l.status === "open") {
      if (isLent) receivable += outstanding;
      else payable += outstanding;
    }

    return {
      _id: l._id,
      person: l.person,
      direction: l.direction,
      note: l.note,
      status: l.status,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      principal, // total ever lent/borrowed
      settledAmount, // total paid back so far
      outstanding,
    };
  });

  return {
    lendings: enriched,
    totals: { receivable, payable, net: receivable - payable },
  };
};
