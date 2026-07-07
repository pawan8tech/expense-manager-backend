import Transaction from "../models/transactionModel.js";
import SavingsGoal from "../models/savingGoalModel.js";
import Budget from "../models/budgetModel.js";
import RecurringRule from "../models/recurringModel.js";
import Debt from "../models/debtModel.js";
import ScheduledPayment from "../models/scheduledPaymentModel.js";
import { generateDueTransactions } from "./recurringController.js";
import { generateDueBills, generateCardBills } from "./billController.js";
import { ensureUserAccounts } from "./accountController.js";
import { computeAccountBalances } from "../utils/accountBalances.js";
import { computeLendingBalances } from "../utils/lendingBalances.js";

// Advance a date by one interval of the given frequency.
const stepNext = (date, freq, interval = 1) => {
  const d = new Date(date);
  const n = Math.max(1, interval || 1);
  if (freq === "daily") d.setDate(d.getDate() + n);
  else if (freq === "weekly") d.setDate(d.getDate() + 7 * n);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n); // monthly default
  return d;
};

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const getDashboard = async (req, res) => {
  try {
    // 1. Materialize any due recurring/bill transactions first, and make sure
    //    the user has their default accounts seeded.
    await generateDueTransactions(req.user.id);
    await generateDueBills(req.user.id);
    await ensureUserAccounts(req.user.id);
    await generateCardBills(req.user.id);

    // 2. Pull transactions once, sorted desc. Event-linked and planned/future
    //    spends are excluded — events are isolated and shown only on their page,
    //    so they never affect balance, income, expense, charts, or recents.
    const transactions = await Transaction.find({
      userId: req.user.id,
      isPlanned: { $ne: true },
      eventId: null,
      lendingId: null,
    }).sort({
      date: -1,
    });

    // 3. Aggregate income / expense / saving totals
    //    NOTE: the model enum is "saving" (singular) — earlier code used
    //    "savings" and silently returned 0.
    let totalIncome = 0;
    let totalExpense = 0;
    let totalSaving = 0;
    // This-month figures for the KPI cards (a dashboard wants "now", not
    // lifetime totals). Balance stays a running all-time total.
    let monthIncome = 0;
    let monthExpense = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyData = {};
    const categoryExpenseMap = {};

    for (const t of transactions) {
      const amount = t.amount || 0;

      if (t.type === "income") totalIncome += amount;
      else if (t.type === "expense") totalExpense += amount;
      else if (t.type === "saving") totalSaving += amount;

      // This month's income/expense.
      if (new Date(t.date) >= monthStart) {
        if (t.type === "income") monthIncome += amount;
        else if (t.type === "expense") monthExpense += amount;
      }

      // Monthly summary — key includes the year so different years don't
      // collide on the same short month name.
      const date = new Date(t.date);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          name: `${monthNames[date.getMonth()]} ${date.getFullYear()}`,
          Expenses: 0,
          Income: 0,
          Savings: 0,
        };
      }
      if (t.type === "expense") monthlyData[monthKey].Expenses += amount;
      else if (t.type === "income") monthlyData[monthKey].Income += amount;
      else if (t.type === "saving") monthlyData[monthKey].Savings += amount;

      // Per-category expense breakdown for the doughnut chart.
      if (t.type === "expense") {
        categoryExpenseMap[t.category] =
          (categoryExpenseMap[t.category] || 0) + amount;
      }
    }

    // Balance now comes from account balances (spendable across cash/bank/
    // wallet), not the global income − expense − saving formula — so credit-card
    // spends and transfers don't distort it.
    const { accounts: accountBalances, totals: accountTotals } =
      await computeAccountBalances(req.user.id);
    const balance = accountTotals.liquidAssets;

    const monthlySummary = Object.keys(monthlyData)
      .sort()
      .map((key) => monthlyData[key]);

    const categoryWiseExpense = Object.entries(categoryExpenseMap).map(
      ([name, value]) => ({ name, value })
    );

    // 4. Savings goals summary — goal-type only for the progress ring, since
    //    investments have no target (they'd skew saved/target). Investment
    //    value is rolled up separately.
    const goals = await SavingsGoal.find({ userId: req.user.id });
    const goalOnly = goals.filter((g) => g.type !== "investment");
    const investmentsOnly = goals.filter((g) => g.type === "investment");
    const totalGoalTarget = goalOnly.reduce(
      (sum, g) => sum + (g.targetAmount || 0),
      0
    );
    const totalGoalSaved = goalOnly.reduce(
      (sum, g) => sum + (g.savedAmount || 0),
      0
    );
    const totalInvested = investmentsOnly.reduce((sum, g) => sum + (g.savedAmount || 0), 0);
    const totalInvestmentValue = investmentsOnly.reduce((sum, g) => sum + (g.currentValue || 0), 0);
    const activeGoals = goalOnly.filter((g) => g.status === "active").length;
    const completedGoals = goalOnly.filter((g) => g.status === "completed").length;

    // 5. Budgets — current-month budget if it exists, otherwise newest.
    //    Use the real model field (`totalBudget`), not the previous `b.amount`
    //    which was undefined and made `totalBudget` NaN on the client.
    const now = new Date();
    let activeBudget = await Budget.findOne({
      userId: req.user.id,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ startDate: -1 });

    if (!activeBudget) {
      activeBudget = await Budget.findOne({ userId: req.user.id }).sort({
        startDate: -1,
      });
    }

    const totalBudget = activeBudget?.totalBudget || 0;
    // Utilized = non-event expenses WITHIN the active budget's period. (Using
    // all-time totalExpense here previously made the budget look wildly over;
    // and event spends belong to their own event budget, not the monthly one.)
    let utilizedBudget = 0;
    const budgetCategorySpend = {};
    if (activeBudget) {
      const bStart = new Date(activeBudget.startDate);
      const bEnd = new Date(activeBudget.endDate);
      bEnd.setHours(23, 59, 59, 999);
      for (const t of transactions) {
        if (t.type !== "expense" || t.eventId) continue;
        const d = new Date(t.date);
        if (d >= bStart && d <= bEnd) {
          utilizedBudget += t.amount || 0;
          budgetCategorySpend[t.category] =
            (budgetCategorySpend[t.category] || 0) + (t.amount || 0);
        }
      }
    }
    const remainingBudget = totalBudget - utilizedBudget;

    const categoryWiseBudget = (activeBudget?.categories || []).map((c) => {
      const spent = budgetCategorySpend[c.category] || 0;
      return {
        category: c.category,
        budget: c.amount,
        spent,
        remaining: c.amount - spent,
      };
    });

    // 6. Net worth = (assets − credit-card debt, EXCLUDING loans) + investment
    //    value + money owed to you (receivable) − money you owe others (payable).
    //    Goal savings are NOT added — they're earmarked money still sitting in
    //    the accounts above (adding them would double-count). Loans are left out
    //    because they're offset by a physical asset the app doesn't track.
    const { totals: lendingTotals } = await computeLendingBalances(req.user.id);
    const netWorth =
      accountTotals.netExclLoans +
      totalInvestmentValue +
      (lendingTotals.net || 0);

    // 7. Upcoming bills — next occurrence of each active recurring rule and SIP,
    //    soonest first.
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    const upcoming = [];

    const recurringRules = await RecurringRule.find({ userId: req.user.id, isActive: true });
    for (const r of recurringRules) {
      let next = r.lastGenerated ? new Date(r.lastGenerated) : new Date(r.startDate);
      let guard = 0;
      while (next < t0 && guard++ < 600) next = stepNext(next, r.frequency, r.interval);
      if (r.endDate && next > new Date(r.endDate)) continue;
      upcoming.push({ name: r.name, amount: r.amount, type: r.type, category: r.category, date: next, kind: "recurring" });
    }

    for (const g of goals) {
      if (!g.sipEnabled || !(g.sipAmount > 0) || g.status !== "active") continue;
      let next = g.sipLastRun
        ? stepNext(new Date(g.sipLastRun), g.sipFrequency)
        : new Date(g.sipStartDate || g.startDate);
      let guard = 0;
      while (next < t0 && guard++ < 600) next = stepNext(next, g.sipFrequency);
      upcoming.push({ name: g.name, amount: g.sipAmount, type: "saving", category: g.category, date: next, kind: "sip" });
    }

    // Loan EMIs — next due date of each active debt with an EMI amount.
    const debts = await Debt.find({ userId: req.user.id, status: "active" });
    for (const d of debts) {
      if (!(d.emiAmount > 0) || !d.nextDueDate) continue;
      upcoming.push({
        name: d.name,
        amount: d.emiAmount,
        type: "expense",
        category: "EMI",
        date: new Date(d.nextDueDate),
        kind: "emi",
      });
    }

    // Scheduled bills — the next due occurrence of every active, unpaid bill
    // (auto-post bills show their upcoming future date; reminders show whatever
    // the user still needs to pay).
    const bills = await ScheduledPayment.find({
      userId: req.user.id,
      isActive: true,
      isPaid: false,
    });
    for (const b of bills) {
      if (!b.dueDate) continue;
      upcoming.push({
        name: b.name,
        amount: b.amount,
        type: b.type,
        category: b.category || "Bills",
        date: new Date(b.dueDate),
        kind: "bill",
      });
    }

    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
    const upcomingBills = upcoming.slice(0, 5);

    // 8. Response
    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        totalSaving,
        balance,
        netWorth,
        monthIncome,
        monthExpense,
        upcomingBills,

        // Per-account balances + rollups for the dashboard accounts breakdown.
        accounts: accountBalances,
        accountTotals,

        // Lending rollups (money owed to you / by you).
        lendingTotals,

        budget: {
          totalBudget,
          utilizedBudget,
          remainingBudget,
        },

        savingsGoals: {
          totalTarget: totalGoalTarget,
          totalSaved: totalGoalSaved,
          totalInvested,
          totalInvestmentValue,
          activeGoals,
          completedGoals,
        },

        monthlySummary,
        categoryWiseExpense,
        categoryWiseBudget,

        recentTransactions: transactions.slice(0, 10),
      },
    });
  } catch (err) {
    console.error("getDashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
