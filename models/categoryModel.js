import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: 60,
    },
    type: {
      type: String,
      enum: ["income", "expense"],
      required: true,
    },
    // True for seeded defaults — these can be hidden but not deleted, so a
    // user always has a sane baseline to pick from.
    isSystem: {
      type: Boolean,
      default: false,
    },
    // User can hide a category to keep it out of pickers without losing
    // historical transactions tagged with it.
    hidden: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// One name per (user, type)
categorySchema.index({ userId: 1, type: 1, name: 1 }, { unique: true });

export default mongoose.model("Category", categorySchema);
