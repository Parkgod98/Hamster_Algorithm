import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

const sourceFiles = walk(path.join(root, "src")).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file));
for (const file of sourceFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");
  if (rel === "src/lib/db.ts") continue;

  // All application table access must go through src/lib/db.ts. This prevents a
  // future change from accidentally querying MyScheduler tables in the shared project.
  const hardcodedFrom = [...text.matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g)];
  for (const match of hardcodedFrom) {
    errors.push(`${rel}: 물리 테이블 이름 직접 사용 금지 (.from(${match[1]})); DB 상수를 사용하세요.`);
  }
}

const migrationDir = path.join(root, "supabase", "migrations");
for (const file of walk(migrationDir).filter((f) => f.endsWith(".sql"))) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  const text = fs.readFileSync(file, "utf8");

  // Hamster migrations may reference auth.users and pgcrypto, but every public
  // application-owned relation/function/index/policy must be hamster-prefixed.
  const publicRefs = [...text.matchAll(/public\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
  for (const name of publicRefs) {
    if (!name.startsWith("hamster_")) {
      errors.push(`${rel}: shared Supabase의 public object '${name}' 참조 금지; hamster_ prefix가 필요합니다.`);
    }
  }

  const objectDecls = [...text.matchAll(/\b(?:table|function|index|policy)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi)].map((m) => m[1]);
  for (const name of objectDecls) {
    if (!name.startsWith("hamster_") && name !== "pgcrypto") {
      errors.push(`${rel}: 선언 object '${name}'은 hamster_ prefix가 필요합니다.`);
    }
  }
}

if (errors.length) {
  console.error("Supabase isolation validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Supabase isolation validation passed.");
