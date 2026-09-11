import fs from "node:fs";

const required = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/product-spec.md",
  "docs/git-conventions.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/ci.yml",
  "supabase/migrations/202609110001_initial_schema.sql",
  "src/lib/rules.ts",
  "src/lib/baekjoonhub.ts",
  "src/app/manifest.ts",
];

const forbidden = [".env", ".env.local"];
const errors = [];
for (const path of required) if (!fs.existsSync(path)) errors.push(`필수 파일 누락: ${path}`);
for (const path of forbidden) if (fs.existsSync(path)) errors.push(`비밀 파일 커밋 금지: ${path}`);
if (errors.length) {
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}
console.log("Project validation passed.");
