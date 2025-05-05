const express = require("express");
const router = express.Router();
const {
  addExpense,
  deleteExpense,
  getExpenses,
  getExpense,
  updateExpense,
} = require("../controllers/expenseController");
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken);
router.route("/").get(getExpenses).post(addExpense);
router.route("/:type").get(getExpense).put(updateExpense).delete(deleteExpense);

module.exports = router;
