/**
 * Event Routes
 *
 * API endpoints for managing big-event plans, their linked transactions, and
 * funding contributions.
 */
import express from "express";
import {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  updateEventStatus,
  deleteEvent,
  addEventTransaction,
  confirmPlannedTransaction,
  updateEventTransaction,
  deleteEventTransaction,
  addFundingSource,
  updateFundingSource,
  deleteFundingSource,
} from "../controllers/eventController.js";
import validateToken from "../middleware/validateTokenHandler.js";

const router = express.Router();
router.use(validateToken);

// GET  /api/events       - list events with summary
// POST /api/events       - create an event
router.route("/").get(getEvents).post(createEvent);

// GET    /api/events/:id - single event with transactions + computed spend
// PUT    /api/events/:id - update event details
// DELETE /api/events/:id - delete event (keeps actual transactions)
router.route("/:id").get(getEventById).put(updateEvent).delete(deleteEvent);

// PATCH /api/events/:id/status - update event status
router.patch("/:id/status", updateEventStatus);

// POST /api/events/:id/transactions - add an actual or planned transaction
router.post("/:id/transactions", addEventTransaction);

// PATCH  /api/events/:id/transactions/:txId/confirm - planned -> actual
router.patch("/:id/transactions/:txId/confirm", confirmPlannedTransaction);

// PUT    /api/events/:id/transactions/:txId - edit a linked transaction
// DELETE /api/events/:id/transactions/:txId - remove a linked transaction
router.route("/:id/transactions/:txId").put(updateEventTransaction).delete(deleteEventTransaction);

// Funding plan — sources of money for the event (planning only)
// POST   /api/events/:id/fund          - add a funding source
// PUT    /api/events/:id/fund/:fundId  - update a funding source
// DELETE /api/events/:id/fund/:fundId  - remove a funding source
router.post("/:id/fund", addFundingSource);
router.route("/:id/fund/:fundId").put(updateFundingSource).delete(deleteFundingSource);

export default router;
