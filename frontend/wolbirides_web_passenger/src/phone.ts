/**
 * A dialable number for this account, or "" when there isn't one. Email-only accounts store a
 * private placeholder ("email:<hash>") in the phone column, and merged duplicates "merged:<...>";
 * neither is a real number and neither should ever be shown or prefilled as one.
 */
export function realPhone(user: { phone?: string | null } | null | undefined): string {
  const phone = user?.phone ?? "";
  return phone.startsWith("email:") || phone.startsWith("merged:") ? "" : phone;
}

/** Whether two numbers are the same phone however they were typed ("0241234567" vs "+233241234567"). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const last9 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-9);
  return last9(a).length === 9 && last9(a) === last9(b);
}
