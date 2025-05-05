require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

app.use("/api/expenses", require("./routes/expenseRoutes"));
app.use("/api/users", require("./routes/userRoutes"));

// Connect to MongoDB
connectDB();

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
