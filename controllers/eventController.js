/**
 * Event Controller
 *
 * CRUD for big-event plans plus the money that flows through them:
 *   - linked transactions (actual spends + planned/future spends)
 *   - funding contributions (savedAmount toward the estimate)
 *
 * Spend figures are computed from the Transaction collection on read, so the
 * event document never drifts out of sync with the transactions behind it.
 */
import Event from "../models/eventModel.js";
import Transaction from "../models/transactionModel.js";
import mongoose from "mongoose";

// ===================================
// Helpers
// ===================================

/**
 * Compute actual-spent, planned-upcoming, and per-category breakdown for an
 * event from its linked transactions. Returns a plain object merged into the
 * event payload sent to the client.
 */
const computeEventSpend = async (eventId, categories = []) => {
  const txs = await Transaction.find({ eventId, type: "expense" });

  let actualSpent = 0;
  let plannedUpcoming = 0;
  const spentByCategory = {};

  for (const tx of txs) {
    if (tx.isPlanned) {
      plannedUpcoming += tx.amount;
    } else {
      actualSpent += tx.amount;
    }
    const key = tx.category || "Uncategorized";
    if (!spentByCategory[key]) spentByCategory[key] = { actual: 0, planned: 0 };
    if (tx.isPlanned) spentByCategory[key].planned += tx.amount;
    else spentByCategory[key].actual += tx.amount;
  }

  // Merge the plan (categories) with what's actually been spent per category.
  const categoryBreakdown = (categories || []).map((c) => {
    const found = spentByCategory[c.category] || { actual: 0, planned: 0 };
    return {
      category: c.category,
      plannedAmount: c.plannedAmount,
      actualSpent: found.actual,
      plannedSpent: found.planned,
      remaining: c.plannedAmount - found.actual,
    };
  });

  // Surface spend in categories the user never planned for, so nothing hides.
  for (const [category, amounts] of Object.entries(spentByCategory)) {
    if (!categoryBreakdown.find((c) => c.category === category)) {
      categoryBreakdown.push({
        category,
        plannedAmount: 0,
        actualSpent: amounts.actual,
        plannedSpent: amounts.planned,
        remaining: -amounts.actual,
      });
    }
  }

  return {
    actualSpent,
    plannedUpcoming,
    categoryBreakdown,
    transactionCount: txs.length,
  };
};

// Validate event input. Returns an error string, or null when valid.
const validateEventPayload = (fields, { requireAll = false } = {}) => {
  const { name, estimatedCost, categories } = fields;

  if (requireAll) {
    if (!name || !String(name).trim()) return "Event name is required";
    if (estimatedCost === undefined) return "Estimated cost is required";
  }

  if (estimatedCost !== undefined && (!Number.isFinite(Number(estimatedCost)) || Number(estimatedCost) <= 0)) {
    return "Estimated cost must be a positive number";
  }

  if (categories !== undefined) {
    if (!Array.isArray(categories)) return "Categories must be a list";
    for (const c of categories) {
      if (!c || !c.category || !String(c.category).trim()) return "Each category needs a name";
      const amt = Number(c.plannedAmount);
      if (!Number.isFinite(amt) || amt < 0) return `Invalid planned amount for "${c.category}"`;
    }
  }

  return null;
};

// ===================================
// Event CRUD
// ===================================

/**
 * Create a new event plan
 * POST /api/events
 */
export const createEvent = async (req, res) => {
  try {
    const { name, type, eventDate, estimatedCost, categories, note, color } = req.body;

    const validationError = validateEventPayload(
      { name, estimatedCost, categories },
      { requireAll: true }
    );
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const event = await Event.create({
      userId: req.user.id,
      name,
      type,
      eventDate,
      estimatedCost,
      categories: Array.isArray(categories) ? categories : [],
      note,
      color,
    });

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating event", error: error.message });
  }
};

/**
 * Get all events for a user with summary
 * GET /api/events
 */
export const getEvents = async (req, res) => {
  try {
    const events = await Event.find({ userId: req.user.id }).sort({ eventDate: 1, createdAt: -1 });

    // Pull actual vs planned spend for every event in a single aggregation
    // instead of one query per event (avoids N+1 as events grow).
    const eventIds = events.map((e) => e._id);
    const spendRows = await Transaction.aggregate([
      { $match: { eventId: { $in: eventIds }, type: "expense" } },
      { $group: { _id: { eventId: "$eventId", isPlanned: "$isPlanned" }, total: { $sum: "$amount" } } },
    ]);

    const spendMap = {};
    for (const row of spendRows) {
      const id = String(row._id.eventId);
      if (!spendMap[id]) spendMap[id] = { actualSpent: 0, plannedUpcoming: 0 };
      if (row._id.isPlanned) spendMap[id].plannedUpcoming += row.total;
      else spendMap[id].actualSpent += row.total;
    }

    const enriched = events.map((event) => ({
      ...event.toJSON(),
      actualSpent: spendMap[String(event._id)]?.actualSpent || 0,
      plannedUpcoming: spendMap[String(event._id)]?.plannedUpcoming || 0,
    }));

    const summary = {
      totalEvents: events.length,
      upcoming: events.filter((e) => e.status !== "completed" && e.status !== "cancelled").length,
      completed: events.filter((e) => e.status === "completed").length,
      totalEstimated: events.reduce((s, e) => s + (e.estimatedCost || 0), 0),
      totalSaved: events.reduce((s, e) => s + (e.savedAmount || 0), 0),
      totalSpent: enriched.reduce((s, e) => s + (e.actualSpent || 0), 0),
    };

    res.json({ success: true, summary, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching events", error: error.message });
  }
};

/**
 * Get a single event with its linked transactions and computed spend
 * GET /api/events/:id
 */
export const getEventById = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, userId: req.user.id });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const spend = await computeEventSpend(event._id, event.categories);
    const transactions = await Transaction.find({ eventId: event._id }).sort({ date: -1 });

    res.json({
      success: true,
      data: {
        ...event.toJSON(),
        ...spend,
        transactions,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching event", error: error.message });
  }
};

/**
 * Update event details
 * PUT /api/events/:id
 */
export const updateEvent = async (req, res) => {
  try {
    const { name, type, eventDate, estimatedCost, categories, note, color } = req.body;

    const validationError = validateEventPayload({ name, estimatedCost, categories });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const update = { name, type, eventDate, estimatedCost, note, color };
    if (Array.isArray(categories)) update.categories = categories;

    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      update,
      { new: true, runValidators: true }
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating event", error: error.message });
  }
};

/**
 * Update event status (planning/active/completed/cancelled)
 * PATCH /api/events/:id/status
 */
export const updateEventStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["planning", "active", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { status },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating event status", error: error.message });
  }
};

/**
 * Delete an event. Linked transactions are kept but unlinked (eventId nulled)
 * so the user never loses real spend history — except planned ones, which only
 * existed for the event and are removed.
 * DELETE /api/events/:id
 */
export const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findOneAndDelete({ _id: req.params.id, userId: req.user.id });

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Planned-only transactions vanish with the event; actual ones are kept.
    await Transaction.deleteMany({ eventId: event._id, isPlanned: true });
    await Transaction.updateMany({ eventId: event._id }, { $set: { eventId: null } });

    res.json({ success: true, message: "Event deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting event", error: error.message });
  }
};

// ===================================
// Event Transactions
// ===================================

/**
 * Add a transaction (actual spend or planned/future spend) to an event
 * POST /api/events/:id/transactions
 */
export const addEventTransaction = async (req, res) => {
  try {
    const { name, amount, category, note, date, isPlanned } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be positive" });
    }

    const event = await Event.findOne({ _id: req.params.id, userId: req.user.id });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const transaction = await Transaction.create({
      userId: req.user.id,
      type: "expense",
      name: name || event.name,
      amount,
      category: category || "Event",
      note: note || `Expense for ${event.name}`,
      date: date || new Date(),
      eventId: event._id,
      isPlanned: !!isPlanned,
    });

    const spend = await computeEventSpend(event._id, event.categories);

    res.status(201).json({ success: true, data: { transaction, event: { ...event.toJSON(), ...spend } } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error adding event transaction", error: error.message });
  }
};

/**
 * Confirm a planned transaction — it becomes an actual spend (and starts
 * affecting the balance and main transaction list).
 * PATCH /api/events/:id/transactions/:txId/confirm
 */
export const confirmPlannedTransaction = async (req, res) => {
  try {
    const { id, txId } = req.params;

    const event = await Event.findOne({ _id: id, userId: req.user.id });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: txId, eventId: id, userId: req.user.id },
      { $set: { isPlanned: false, date: req.body.date || new Date() } },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Planned transaction not found" });
    }

    const spend = await computeEventSpend(event._id, event.categories);

    res.json({ success: true, data: { transaction, event: { ...event.toJSON(), ...spend } } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error confirming transaction", error: error.message });
  }
};

/**
 * Edit a transaction linked to an event
 * PUT /api/events/:id/transactions/:txId
 */
export const updateEventTransaction = async (req, res) => {
  try {
    const { id, txId } = req.params;
    const { name, amount, category, note, date, isPlanned } = req.body;

    if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
      return res.status(400).json({ success: false, message: "Amount must be positive" });
    }

    const event = await Event.findOne({ _id: id, userId: req.user.id });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const update = {};
    if (name !== undefined) update.name = name;
    if (amount !== undefined) update.amount = amount;
    if (category !== undefined) update.category = category;
    if (note !== undefined) update.note = note;
    if (date !== undefined) update.date = date;
    if (isPlanned !== undefined) update.isPlanned = !!isPlanned;

    const transaction = await Transaction.findOneAndUpdate(
      { _id: txId, eventId: id, userId: req.user.id },
      { $set: update },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const spend = await computeEventSpend(event._id, event.categories);

    res.json({ success: true, data: { transaction, event: { ...event.toJSON(), ...spend } } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating event transaction", error: error.message });
  }
};

/**
 * Delete a transaction linked to an event
 * DELETE /api/events/:id/transactions/:txId
 */
export const deleteEventTransaction = async (req, res) => {
  try {
    const { id, txId } = req.params;

    const event = await Event.findOne({ _id: id, userId: req.user.id });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const transaction = await Transaction.findOneAndDelete({
      _id: txId,
      eventId: id,
      userId: req.user.id,
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const spend = await computeEventSpend(event._id, event.categories);

    res.json({ success: true, data: { event: { ...event.toJSON(), ...spend } } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting event transaction", error: error.message });
  }
};

// ===================================
// Event Funding
// ===================================

/**
 * Add funds toward an event (increase savedAmount). Mirrors a savings
 * contribution: records a `saving` transaction so cashflow reports stay
 * accurate, and bumps the event's savedAmount.
 * POST /api/events/:id/fund
 */
export const fundEvent = async (req, res) => {
  try {
    const { amount, note, date } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be positive" });
    }

    const event = await Event.findOne({ _id: req.params.id, userId: req.user.id });
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const transaction = await Transaction.create({
      userId: req.user.id,
      type: "saving",
      name: `Funding: ${event.name}`,
      amount,
      category: "Event Fund",
      note: note || `Saved toward ${event.name}`,
      date: date || new Date(),
      eventId: event._id,
    });

    event.savedAmount = Number(event.savedAmount) + Number(amount);
    if (event.status === "planning") event.status = "active";
    await event.save();

    res.status(201).json({ success: true, data: { event, transaction } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error funding event", error: error.message });
  }
};
