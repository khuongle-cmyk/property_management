export const LEAD_STAGES = [
  "new",
  "contacted",
  "viewing",
  "offer_sent",
  "negotiation",
  "won",
  "lost",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  viewing: "Viewing",
  offer_sent: "Offer sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export const LEAD_ACTIVITY_TYPES = [
  "email_sent",
  "email_received",
  "phone_call_made",
  "viewing_scheduled",
  "viewing_completed",
  "note_added",
  "stage_changed",
  "offer_sent",
  "document_shared",
] as const;

export const LEAD_SOURCES = [
  "email",
  "website",
  "phone",
  "chatbot",
  "social_media",
  "referral",
  "other",
] as const;

export const LOST_REASONS = [
  "price_too_high",
  "space_too_small",
  "space_too_large",
  "chose_competitor",
  "no_longer_needed",
  "other",
] as const;

