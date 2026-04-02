const AVATAR_COLORS = ["#4CAF50", "#FF9800", "#2196F3", "#9C27B0", "#009688", "#E91E63", "#FFC107", "#673AB7"] as const;

export function getUserAvatarColor(userId: string): string {
  const hash = userId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}
