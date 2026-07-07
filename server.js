/**
 * IMPORTANT: Bypass SSL certificate verification for development
 * This fixes "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" errors in corporate/proxy environments
 * Remove this in production or use proper CA certificates
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import connectDB from "./config/db.js";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import transactionRoutes from "./routes/transactionRoutes.js";
import userRoutes from './routes/userRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import recurringRoutes from './routes/recurringRoutes.js';
import budgetRoutes from './routes/budgetRoutes.js';
import savingGoalRoutes from './routes/savingGoalRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import debtRoutes from './routes/debtRoutes.js';
import billRoutes from './routes/billRoutes.js';
import lendingRoutes from './routes/lendingRoutes.js';
import cookieParser from "cookie-parser";


dotenv.config();

const app = express();
app.use(cookieParser());
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));


const PORT = process.env.PORT || 5001;

// Middleware
app.use(express.json());
app.use("/api/savings-goals",savingGoalRoutes);
app.use("/api/events",eventRoutes);
app.use("/api/budget",budgetRoutes);
app.use("/api/dashboard",dashboardRoutes);
app.use("/api/recurring",recurringRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/debts", debtRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/lendings", lendingRoutes);


// Connect to MongoDB
connectDB();

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
