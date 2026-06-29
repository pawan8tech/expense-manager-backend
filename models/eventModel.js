/**
 * Event Model
 *
 * A big life event (marriage, birthday, vacation, housewarming, …) acts as a
 * planning container that ties together three things the rest of the app
 * already does separately:
 *   - a category-wise spending plan (like Budget)
 *   - a savings target to fund it (like SavingsGoal)
 *   - linked transactions, both already-spent and planned/future
 *
 * Linked transactions live in the Transaction model and point back here via
 * `eventId`. A planned (future) transaction carries `isPlanned: true` so it
 * counts toward the plan without touching the user's current balance until it
 * is confirmed.
 */
import mongoose from "mongoose";

// Per-category planned amount for the event (venue, catering, decor, …).
const EventCategorySchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    plannedAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["marriage", "birthday", "vacation", "housewarming", "festival", "other"],
      default: "other",
    },
    eventDate: {
      type: Date,
    },
    // Total estimated cost of the event. If category amounts are provided they
    // should roughly sum to this, but it is stored independently so a user can
    // set a headline budget before breaking it down.
    estimatedCost: {
      type: Number,
      required: true,
      min: [1, "Estimated cost must be positive"],
    },
    // Money the user has set aside specifically to fund this event.
    savedAmount: {
      type: Number,
      default: 0,
    },
    categories: [EventCategorySchema],
    status: {
      type: String,
      enum: ["planning", "active", "completed", "cancelled"],
      default: "planning",
    },
    note: { type: String },
    color: {
      type: String,
      default: "#6366f1",
    },
  },
  { timestamps: true }
);

// Funding progress — how much of the estimate is already saved.
eventSchema.virtual("fundingProgress").get(function () {
  if (!this.estimatedCost || this.estimatedCost === 0) return 0;
  return Math.min(100, Math.round((this.savedAmount / this.estimatedCost) * 100));
});

eventSchema.set("toJSON", { virtuals: true });
eventSchema.set("toObject", { virtuals: true });

export default mongoose.model("Event", eventSchema);
