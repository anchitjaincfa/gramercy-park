export * from './schema';
export { schema } from './schema';

/**
 * SQL snippet the app must run (as `SET LOCAL`) at the start of every
 * transaction to scope RLS to the current firm. Kept here so callers don't
 * hand-roll the setting name. Example:
 *
 *   await tx.execute(sql.raw(setCurrentFirm(firmId)));
 */
export function setCurrentFirm(firmId: string): string {
  // firmId must be a validated UUID from the auth layer, never raw user input.
  return `SET LOCAL app.current_firm = '${firmId}'`;
}
