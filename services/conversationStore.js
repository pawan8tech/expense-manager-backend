/**
 * Conversation Store - In-memory storage for conversation state
 * 
 * In production, replace with Redis or similar for:
 * - Persistence across server restarts
 * - Scalability across multiple server instances
 * - TTL/expiration support
 */

import { v4 as uuidv4 } from "uuid";

// In-memory store: Map<conversationId, ConversationState>
const conversations = new Map();

// TTL for conversations (30 minutes)
const CONVERSATION_TTL_MS = 30 * 60 * 1000;

/**
 * Create a new conversation
 * @param {string} userId - User ID for the conversation
 * @returns {object} - New conversation state
 */
export function createConversation(userId) {
  const conversationId = uuidv4();
  const now = new Date();
  
  const state = {
    conversationId,
    userId,
    intent: null,
    draft: {},
    missingFields: [],
    status: "IDLE",
    createdAt: now,
    updatedAt: now,
  };
  
  conversations.set(conversationId, state);
  return state;
}

/**
 * Get conversation by ID
 * @param {string} conversationId 
 * @returns {object|null} - Conversation state or null if not found/expired
 */
export function getConversation(conversationId) {
  const state = conversations.get(conversationId);
  
  if (!state) {
    return null;
  }
  
  // Check if conversation has expired
  const now = new Date();
  if (now - state.updatedAt > CONVERSATION_TTL_MS) {
    conversations.delete(conversationId);
    return null;
  }
  
  return state;
}

/**
 * Get or create conversation for a user
 * If conversationId is provided and valid, return that conversation
 * Otherwise, create a new one
 * 
 * @param {string} conversationId - Optional existing conversation ID
 * @param {string} userId - User ID
 * @returns {object} - Conversation state
 */
export function getOrCreateConversation(conversationId, userId) {
  if (conversationId) {
    const existing = getConversation(conversationId);
    if (existing && existing.userId === userId) {
      return existing;
    }
  }
  return createConversation(userId);
}

/**
 * Update conversation state
 * @param {string} conversationId 
 * @param {object} updates - Partial updates to apply
 * @returns {object|null} - Updated state or null if not found
 */
export function updateConversation(conversationId, updates) {
  const state = getConversation(conversationId);
  
  if (!state) {
    return null;
  }
  
  // Merge updates
  const updatedState = {
    ...state,
    ...updates,
    updatedAt: new Date(),
  };
  
  // Deep merge draft if provided
  if (updates.draft) {
    updatedState.draft = {
      ...state.draft,
      ...updates.draft,
    };
  }
  
  conversations.set(conversationId, updatedState);
  return updatedState;
}

/**
 * Merge extracted AI data into conversation draft
 * Only updates fields that have non-null values
 * 
 * @param {string} conversationId 
 * @param {object} extractedData - Data extracted by AI
 * @returns {object|null} - Updated state or null
 */
export function mergeDraftData(conversationId, extractedData) {
  const state = getConversation(conversationId);
  
  if (!state) {
    return null;
  }
  
  // Only merge non-null values from extracted data
  const newDraft = { ...state.draft };
  for (const [key, value] of Object.entries(extractedData)) {
    if (value !== null && value !== undefined) {
      newDraft[key] = value;
    }
  }
  
  return updateConversation(conversationId, { draft: newDraft });
}

/**
 * Reset conversation to idle state
 * @param {string} conversationId 
 * @returns {object|null} - Reset state or null
 */
export function resetConversation(conversationId) {
  const state = getConversation(conversationId);
  
  if (!state) {
    return null;
  }
  
  return updateConversation(conversationId, {
    intent: null,
    draft: {},
    missingFields: [],
    status: "IDLE",
  });
}

/**
 * Delete a conversation
 * @param {string} conversationId 
 * @returns {boolean} - True if deleted
 */
export function deleteConversation(conversationId) {
  return conversations.delete(conversationId);
}

/**
 * Clean up expired conversations
 * Call this periodically to prevent memory leaks
 */
export function cleanupExpiredConversations() {
  const now = new Date();
  let cleaned = 0;
  
  for (const [id, state] of conversations.entries()) {
    if (now - state.updatedAt > CONVERSATION_TTL_MS) {
      conversations.delete(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired conversations`);
  }
  
  return cleaned;
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredConversations, 10 * 60 * 1000);

export default {
  createConversation,
  getConversation,
  getOrCreateConversation,
  updateConversation,
  mergeDraftData,
  resetConversation,
  deleteConversation,
  cleanupExpiredConversations,
};
