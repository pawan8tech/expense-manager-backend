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

dotenv.config();

const app = express();
app.use(cors({
  origin: ["https://finance-manager-seven-self.vercel.app/"], // replace with your Vercel URL
  credentials: true
}));


const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use("/api/savings-goals",savingGoalRoutes);
app.use("/api/budget",budgetRoutes);
app.use("/api/dashboard",dashboardRoutes);
app.use("/api/recurring",recurringRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/users", userRoutes);


// Connect to MongoDB
connectDB();

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
