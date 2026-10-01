/* The current copy of a record a dialog was opened with. A dialog keeps the
   record it opened on; after a 412, useRecordMutation re-reads the screen's
   queries, and the next attempt must send the version just read, not the one
   that was refused. When the list no longer has the record, the held copy
   stands (the server then says what happened to it). */
export const latest = <T extends { id: string }>(held: T, rows: readonly T[] | undefined): T =>
  rows?.find(r => r.id === held.id) ?? held;

/* A key that remounts a dialog when its record gets a new version, so its
   draft starts again from what the server now holds instead of resending
   values read before someone else's change. */
export const versionKey = (r: { id: string; version: number }) => `${r.id}@${r.version}`;
