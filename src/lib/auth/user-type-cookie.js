/** Client-only: marks portal vs staff for middleware routing. */
export function setUserTypeCookie(value) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `user_type=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearUserTypeCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "user_type=; path=/; max-age=0; SameSite=Lax";
}

/** portal | dashboard | workspace — set on login to avoid DB lookups in middleware */
export function setAppScopeCookie(value) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `app_scope=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearAppScopeCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "app_scope=; path=/; max-age=0; SameSite=Lax";
}

export function clearAuthCookies() {
  clearUserTypeCookie();
  clearAppScopeCookie();
}
