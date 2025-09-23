// import mongoose from "mongoose";

// const transactionSchema = new mongoose.Schema({
//   userId: { 
//     type: mongoose.Schema.Types.ObjectId, 
//     ref: "User", 
//     required: true 
//   },
//   type: { 
//     type: String, 
//     enum: ["income", "expense"], 
//     required: true 
//   },
//   amount: { 
//     type: Number, 
//     required: true 
//   },
//   category: { 
//     type: String, 
//     required: true 
//   },
//   name: { 
//     type: String 
//   },
//   date: { 
//     type: Date, 
//     default: Date.now 
//   },
// //isRecurring: { 
// // type: Boolean, 
// // default: false 
// // }
// }, { timestamps: true });

// export default mongoose.model("Transaction", transactionSchema);

// src/models/transactionModel.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["income", "expense"], required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  note: { type: String },
  date: { type: Date, default: Date.now },

  // Recurring fields
  isRecurring: { type: Boolean, default: false },
  recurringId: { type: mongoose.Schema.Types.ObjectId, ref: "RecurringRule", default: null }
}, { timestamps: true });

export default mongoose.model("Transaction", transactionSchema);
