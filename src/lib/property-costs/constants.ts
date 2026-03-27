export const PROPERTY_COST_TYPES = [
  "cleaning",
  "utilities",
  "property_management",
  "insurance",
  "security",
  "it_infrastructure",
  "marketing",
  "staff",
  "one_off",
] as const;

export type PropertyCostType = (typeof PROPERTY_COST_TYPES)[number];

export const PROPERTY_COST_TYPE_LABELS: Record<PropertyCostType, string> = {
  cleaning: "Cleaning services",
  utilities: "Electricity, water, heating",
  property_management: "Management fees",
  insurance: "Insurance",
  security: "Security",
  it_infrastructure: "IT and internet",
  marketing: "Marketing costs",
  staff: "Staff costs",
  one_off: "Other one-off costs",
};

export const RECURRING_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export function isPropertyCostType(s: string): s is PropertyCostType {
  return (PROPERTY_COST_TYPES as readonly string[]).includes(s);
}

export function isRecurringFrequency(s: string): s is RecurringFrequency {
  return (RECURRING_FREQUENCIES as readonly string[]).includes(s);
}
