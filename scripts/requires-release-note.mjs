// Only a single plain PostgreSQL catalog comment can qualify as documentation.
const catalogComment = /^comment\s+on\s+(?:table\s+public\.hamster_[a-z0-9_]+|column\s+public\.hamster_[a-z0-9_]+\.[a-z_][a-z0-9_]*)\s+is\s+'[^'\\]+'\s*;$/i;

export function requiresReleaseNote(status, path, readSql) {
  if (/^(src|public)\//.test(path)) return true;
  if (!path.startsWith("supabase/migrations/")) return false;
  if (status !== "A" || !/^supabase\/migrations\/\d{12}_[a-z0-9_]+\.sql$/.test(path)) return true;
  return !catalogComment.test(readSql(path).trim());
}
