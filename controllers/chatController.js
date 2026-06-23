/**
 * Chat Controller - Manages conversation flow between frontend and AI
 * 
 * ARCHITECTURE PRINCIPLES:
 * 1. AI only extracts structured data from user text - NEVER writes to DB
 * 2. Backend controls conversation state
 * 3. User must CONFIRM before any expense is saved
 * 4. Missing information collected via follow-up questions
 * 5. Frontend sends plain messages; backend decides next step
 */

import asyncHandler from "express-async-handler";
import Category from "../models/categoryModel.js";
import { extractExpenseData } from "../services/aiService.js";
import {
  getOrCreateConversation,
  updateConversation,
  mergeDraftData,
  resetConversation,
} from "../services/conversationStore.js";

// Required fields for a complete expense
const REQUIRED_FIELDS = ["amount", "category"];

// Field display names for user-friendly messages
const FIELD_LABELS = {
  amount: "amount",
  category: "category",
  date: "date",
  name: "description",
  note: "note",
};

// The user-facing noun for the current entry ("income" or "expense").
function entryNoun(type) {
  return type === "income" ? "income" : "expense";
}

// Follow-up questions for missing fields, worded for the entry type.
function fieldQuestion(field, type) {
  const noun = entryNoun(type);
  const categoryExamples =
    type === "income"
      ? "Salary, Freelance, Business, Investment, Refund"
      : "Food, Shopping, Transport, Bills";

  switch (field) {
    case "amount":
      return `How much was the ${noun}?`;
    case "category":
      return `What category does this ${noun} belong to? (e.g., ${categoryExamples})`;
    case "date":
      return `When did this ${noun} occur? (e.g., today, yesterday, or a specific date)`;
    case "name":
      return `What would you like to call this ${noun}?`;
    default:
      return `Please provide the ${FIELD_LABELS[field] || field}.`;
  }
}

/**
 * Determine which required fields are missing from the draft
 * @param {object} draft - Current expense draft
 * @returns {string[]} - Array of missing field names
 */
function getMissingFields(draft) {
  return REQUIRED_FIELDS.filter(field => {
    const value = draft[field];
    return value === undefined || value === null || value === "";
  });
}

/**
 * Parse and normalize date from user input
 * Converts relative dates to actual dates
 * @param {string} dateInput - User's date input
 * @returns {string} - ISO date string
 */
function normalizeDate(dateInput) {
  if (!dateInput) {
    // Default to today if no date provided
    return new Date().toISOString().split("T")[0];
  }

  const lower = dateInput.toLowerCase().trim();
  const today = new Date();

  if (lower === "today" || lower === "now") {
    return today.toISOString().split("T")[0];
  }

  if (lower === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split("T")[0];
  }

  if (lower === "last week") {
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return lastWeek.toISOString().split("T")[0];
  }

  // Try to parse as a date
  const parsed = new Date(dateInput);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  // Return as-is if we can't parse it
  return dateInput;
}

/**
 * Generate a response asking for a specific missing field
 * @param {string} field - Missing field name
 * @param {string} conversationId 
 * @returns {object} - Question response
 */
function createQuestionResponse(field, conversationId, entryType) {
  return {
    type: "QUESTION",
    question: fieldQuestion(field, entryType),
    field,
    conversationId,
  };
}

/**
 * Generate a confirmation response with the complete draft
 * @param {object} draft - Complete expense draft
 * @param {string} conversationId 
 * @returns {object} - Confirmation response
 */
function createConfirmationResponse(draft, conversationId) {
  return {
    type: "CONFIRMATION",
    message: `Please confirm the ${entryNoun(draft.type)} details:`,
    draft: {
      ...draft,
      date: normalizeDate(draft.date), // Normalize date for display
    },
    conversationId,
  };
}

/**
 * Generate a success response after user confirms
 * @param {object} draft - Confirmed expense draft
 * @param {string} conversationId 
 * @returns {object} - Success response
 */
function createSuccessResponse(draft, conversationId) {
  return {
    type: "CONFIRMED",
    message: `${entryNoun(draft.type) === "income" ? "Income" : "Expense"} confirmed! Saving to your records.`,
    draft: {
      ...draft,
      date: normalizeDate(draft.date),
    },
    conversationId,
  };
}

/**
 * Generate a cancellation response
 * @param {string} conversationId 
 * @returns {object} - Cancel response
 */
function createCancelResponse(conversationId) {
  return {
    type: "CANCELLED",
    message: "Okay, I've cancelled that. Let me know if you want to add something else!",
    conversationId,
  };
}

/**
 * Generate an error/unknown response
 * @param {string} conversationId 
 * @param {string} message 
 * @returns {object} - Error response
 */
function createErrorResponse(conversationId, message = null) {
  return {
    type: "UNKNOWN",
    message: message || "I'm not sure what you mean. Try saying something like 'I spent 500 on groceries yesterday'.",
    conversationId,
  };
}

/**
 * POST /api/chat/message
 * Main chat endpoint - handles all incoming messages
 * 
 * Request body:
 * {
 *   "conversationId": "string" (optional - creates new if not provided),
 *   "message": "string" (required - user's message)
 * }
 * 
 * Response types:
 * - QUESTION: Asking for missing information
 * - CONFIRMATION: All required fields present, asking user to confirm
 * - CONFIRMED: User confirmed, ready to save (frontend saves via transaction API)
 * - CANCELLED: User cancelled the conversation
 * - UNKNOWN: Could not understand the message
 */
export const handleMessage = asyncHandler(async (req, res) => {
  const { conversationId: inputConversationId, message } = req.body;
  const userId = req.user.id;

  // Validate message is present
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Message is required",
    });
  }

  // Step 1: Get or create conversation state
  const conversation = getOrCreateConversation(inputConversationId, userId);
  const { conversationId } = conversation;

  // Step 2: Call AI to extract expense data from the message
  // Pass the user's own categories so the AI matches against them first
  // and only invents a new name when nothing fits.
  // AI service already validates the response with Zod
  let aiResult;
  try {
    const userCategories = await Category.find({
      userId,
      hidden: { $ne: true },
    })
      .select("name type")
      .lean();
    aiResult = await extractExpenseData(message, {
      expenseCategories: userCategories
        .filter((c) => c.type === "expense")
        .map((c) => c.name),
      incomeCategories: userCategories
        .filter((c) => c.type === "income")
        .map((c) => c.name),
    });
  } catch (error) {
    console.error("AI extraction failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process message",
      conversationId,
    });
  }

  // Step 3: Extract intent and data from validated AI response
  const { intent, data: extractedData } = aiResult;

  console.log("intent", intent) ;
  // Step 4: Handle different intents
  
  // Handle CANCEL intent
  if (intent === "CANCEL") {
    resetConversation(conversationId);
    return res.json({
      success: true,
      data: createCancelResponse(conversationId),
    });
  }

  // Handle CONFIRM intent (user confirming the expense)
  if (intent === "CONFIRM") {
    const currentState = conversation;
    
    // Check if we have a complete draft to confirm
    if (currentState.status !== "READY_TO_CONFIRM") {
      return res.json({
        success: true,
        data: createErrorResponse(conversationId, "There's nothing to confirm yet. Tell me about an expense you'd like to add."),
      });
    }

    // User confirmed - send success response
    // NOTE: We do NOT save to database here. Frontend will call /api/transactions
    const confirmedDraft = { ...currentState.draft };
    resetConversation(conversationId);
    
    return res.json({
      success: true,
      data: createSuccessResponse(confirmedDraft, conversationId),
    });
  }

  // Handle UNKNOWN intent
  if (intent === "UNKNOWN") {
    // If we already have some data in draft, continue collecting
    if (Object.keys(conversation.draft).length > 0) {
      const missingFields = getMissingFields(conversation.draft);
      if (missingFields.length > 0) {
        return res.json({
          success: true,
          data: createQuestionResponse(missingFields[0], conversationId, conversation.draft.type),
        });
      }
    }
    
    return res.json({
      success: true,
      data: createErrorResponse(conversationId),
    });
  }

  // Step 5: Handle ADD_EXPENSE, ADD_INCOME, or UPDATE_FIELD intents
  // Merge extracted data into existing draft
  let updatedState = mergeDraftData(conversationId, extractedData);

  // Set the intent and type when starting/continuing an expense or income.
  // Capture the returned state so `type` is reflected in currentDraft below —
  // otherwise the draft sent to the client has no type and defaults to expense.
  const transactionType = intent === "ADD_INCOME" ? "income" : "expense";
  if (!updatedState.intent || intent === "ADD_EXPENSE" || intent === "ADD_INCOME") {
    updatedState = updateConversation(conversationId, {
      intent,
      draft: { ...updatedState.draft, type: transactionType }
    });
  }
  // Step 6: Check for missing required fields
  const currentDraft = updatedState.draft;
  const missingFields = getMissingFields(currentDraft);

  // Step 7: If fields are missing, ask for the next one
  if (missingFields.length > 0) {
    updateConversation(conversationId, {
      status: "COLLECTING",
      missingFields,
    });

    return res.json({
      success: true,
      data: createQuestionResponse(missingFields[0], conversationId, currentDraft.type),
    });
  }

  // Step 8: All required fields present - ask for confirmation
  updateConversation(conversationId, {
    status: "READY_TO_CONFIRM",
    missingFields: [],
  });

  return res.json({
    success: true,
    data: createConfirmationResponse(currentDraft, conversationId),
  });
});

/**
 * GET /api/chat/conversation/:id
 * Get current conversation state
 */
export const getConversationState = asyncHandler(async (req, res) => {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  const conversation = getOrCreateConversation(conversationId, userId);
  
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: "Conversation not found",
    });
  }

  // Verify conversation belongs to this user
  if (conversation.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: "Access denied",
    });
  }

  return res.json({
    success: true,
    data: {
      conversationId: conversation.conversationId,
      status: conversation.status,
      draft: conversation.draft,
      missingFields: conversation.missingFields,
    },
  });
});

/**
 * POST /api/chat/cancel
 * Cancel current conversation
 */
export const cancelConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.body;
  const userId = req.user.id;

  if (!conversationId) {
    return res.status(400).json({
      success: false,
      error: "Conversation ID is required",
    });
  }

  const conversation = getOrCreateConversation(conversationId, userId);

  if (conversation && conversation.userId === userId) {
    resetConversation(conversationId);
  }

  return res.json({
    success: true,
    data: createCancelResponse(conversationId),
  });
});

/**
 * POST /api/chat/start
 * Start a new conversation
 */
export const startConversation = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  const conversation = getOrCreateConversation(null, userId);

  return res.json({
    success: true,
    data: {
      conversationId: conversation.conversationId,
      message: "Hi! I can help you track your money. Tell me about an expense (e.g. 'I spent 500 on groceries yesterday') or income (e.g. 'got my salary of 50000').",
    },
  });
});

export default {
  handleMessage,
  getConversationState,
  cancelConversation,
  startConversation,
};
