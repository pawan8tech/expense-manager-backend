/**
 * Chat Routes - API endpoints for AI-assisted chat
 * 
 * All routes require authentication via validateToken middleware
 */

import { Router } from "express";
import validateToken from "../middleware/validateTokenHandler.js";
import {
  handleMessage,
  getConversationState,
  cancelConversation,
  selectCategory,
  startConversation,
} from "../controllers/chatController.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(validateToken);

/**
 * POST /api/chat/message
 * Main endpoint - send a message and get AI-assisted response
 * 
 * Body: { conversationId?: string, message: string }
 * Response: { type: QUESTION|CONFIRMATION|CONFIRMED|CANCELLED|UNKNOWN, ... }
 */
router.post("/message", handleMessage);

/**
 * POST /api/chat/start
 * Start a new conversation
 * 
 * Response: { conversationId: string, message: string }
 */
router.post("/start", startConversation);

/**
 * POST /api/chat/cancel
 * Cancel the current conversation
 * 
 * Body: { conversationId: string }
 */
router.post("/cancel", cancelConversation);

/**
 * POST /api/chat/select-category
 * Set the category from the user's own list (no AI). Used when the bot
 * offered a category dropdown.
 *
 * Body: { conversationId: string, category: string }
 */
router.post("/select-category", selectCategory);

/**
 * GET /api/chat/conversation/:id
 * Get current state of a conversation
 */
router.get("/conversation/:id", getConversationState);

export default router;
