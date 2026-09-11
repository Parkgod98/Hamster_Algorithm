import fs from "node:fs";
import { execSync } from "node:child_process";

const allowedTypes = ["feat", "fix", "docs", "refactor", "test", "chore", "ci"];
const typePattern = allowedTypes.join("|");
const branchPattern = new RegExp(`^(${typePattern})/[a-z0-9]+(?:-[a-z0-9]+)*$`);
const titlePattern = new RegExp(`^(${typePattern}):\\s+.+[가-힣].*$`);
const commitPattern = new RegExp(`^(${typePattern}):\\s+.+[가-힣].*$`);
const requiredSections = ["## 변경 내용", "## 검증", "## 데이터 / 보안 확인", "## 참고"];
const errors = [];

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}
function localBranch() {
  try { return execSync("git branch --show-current", { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

const event = readEvent();
const pr = event?.pull_request;
const branch = process.env.GITHUB_HEAD_REF || pr?.head?.ref || localBranch();
if (branch && branch !== "main" && !branchPattern.test(branch)) errors.push(`브랜치명 '${branch}' 형식 오류`);
if (pr) {
  const title = pr.title ?? "";
  const body = pr.body ?? "";
  if (!titlePattern.test(title)) errors.push(`PR 제목 '${title}' 형식 오류`);
  if (branch.split("/")[0] !== title.split(":")[0]) errors.push("브랜치 type과 PR title type이 다릅니다.");
  for (const section of requiredSections) if (!body.includes(section)) errors.push(`PR 본문에 '${section}' 필요`);
  const messages = execSync(`git log --format=%s ${pr.base.sha}..${pr.head.sha}`, { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const message of messages) if (!commitPattern.test(message)) errors.push(`커밋 메시지 '${message}' 형식 오류`);
}
if (errors.length) { errors.forEach((e) => console.error(`- ${e}`)); process.exit(1); }
console.log("Git convention validation passed.");
