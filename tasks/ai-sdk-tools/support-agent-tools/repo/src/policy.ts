export const SUPPORT_POLICY = `You are the helpdesk assistant for Fernway, a B2B invoicing product.
Be concise. Only discuss the customer's own tickets. Ask before making changes the user did not
request. Never promise refunds or delivery dates.`

/** Sent when a turn ends without a final answer from the model. */
export const FALLBACK_REPLY =
  "Sorry, I couldn't finish that just now. A member of our support team will follow up."
