export type SupportedAssistantLanguage =
  | "fi"
  | "sv"
  | "no"
  | "da"
  | "en"
  | "de"
  | "fr"
  | "es"
  | "ru"
  | "et";

export const ASSISTANT_LANGUAGES: Array<{ code: SupportedAssistantLanguage; label: string }> = [
  { code: "fi", label: "Finnish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "ru", label: "Russian" },
  { code: "et", label: "Estonian" },
];

export function normalizeAssistantLanguage(input: string | null | undefined): SupportedAssistantLanguage {
  const code = (input ?? "").trim().toLowerCase().slice(0, 2) as SupportedAssistantLanguage;
  return ASSISTANT_LANGUAGES.some((l) => l.code === code) ? code : "en";
}
