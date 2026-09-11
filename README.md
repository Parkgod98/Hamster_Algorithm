# 🐹 햄쮸터 Algorithm

문제를 풀었는데, 왜 인증을 또 해야 할까요?

**햄쮸터**는 각 스터디원의 GitHub 알고리즘 저장소를 연결해 BaekjoonHub 풀이 기록을 자동으로 읽고, 스터디 규칙에 따라 그날의 인증 여부를 판정하는 PWA입니다.

기존의 `문제 풀이 → GitHub 자동 커밋 → 캡처 → Notion 업로드` 흐름을 `문제 풀이 → 끝`으로 줄이는 것이 목표입니다.

## 핵심 흐름

```text
알고리즘 풀이
    ↓
BaekjoonHub
    ↓
각자의 GitHub Repository
    ↓ push
GitHub App / Webhook
    ↓
햄쮸터 Rule Engine
    ↓
오늘 인증 · 미루기 · 미리 풀기 · 벌금
    ↓
PWA Dashboard
```

스터디원마다 Repository가 달라도 됩니다. 한 사용자에게 여러 Repository를 연결하는 것도 고려한 구조입니다.

## 현재 구현

- GitHub OAuth 로그인
- 스터디 생성 및 초대 링크 참여
- GitHub App 설치를 통한 사용자별 Repository 연결
- GitHub push webhook 서명 검증 및 멱등 처리
- BaekjoonHub의 BOJ / Programmers 풀이 자동 수집
- 오전 4시 기준 Study Day 계산
- 난이도별 하루 인정량 판정
- 최대 2일 미리 풀기 credit 이월
- 23:59 이전 미루기 및 연속 2회 제한
- 미제출 연속 일수에 따른 벌금 기록
- 과거 GitHub commit backfill
- 모바일 우선 PWA Dashboard
- SWEA / CodeTree / Chrome Extension을 붙일 수 있는 manual ingestion API

## Supabase 운영 방식

Free plan 프로젝트 한도를 추가로 사용하지 않기 위해 **MyScheduler의 기존 Supabase project를 공유**합니다.

Hamster 소유 DB object는 전부 `hamster_` prefix로 분리되어 MyScheduler의 기존 table/function/policy와 이름이 충돌하지 않도록 구성했습니다. API에서는 물리 테이블 이름을 `src/lib/db.ts`에서 관리합니다.

`auth.users`는 같은 Supabase Auth tenant를 공유하지만 Hamster와 MyScheduler는 서로 다른 웹 origin에서 세션을 사용합니다. 자세한 적용 순서는 `docs/setup-supabase.md`를 참고하세요.

## 기본 스터디 규칙

| 플랫폼 | 난이도 | 하루 인정량 |
| --- | --- | ---: |
| BOJ | Bronze II ~ I | 3문제 |
| BOJ | Silver V ~ I | 2문제 |
| BOJ | Gold V 이상 | 1문제 |
| SWEA | D2 ~ D3 | 2문제 |
| SWEA | D4 이상 | 1문제 |
| Programmers | Lv.0 ~ Lv.1 | 3문제 |
| Programmers | Lv.2 이상 | 1문제 |
| CodeTree | 삼성 기출 | 1문제 |

- 제출 마감: 오전 4시
- 미루기 신청 마감: 23:59
- 연속 미루기: 최대 2회
- 미리 풀기: 최대 2일
- 연속 미제출 벌금: 1일 10,000원 / 2일 25,000원 / 3일 50,000원

서로 다른 난이도를 섞어 푼 경우는 문제별 하루 필요량의 역수를 `credit`으로 환산해 합계 1 이상이면 완료로 처리합니다. 원 규칙에 명시되지 않은 부분이라 `docs/product-spec.md`에 제품 해석으로 분리해 두었습니다.

## 기술 구성

- Next.js App Router + React + TypeScript
- Supabase Auth + PostgreSQL + RLS
- GitHub App + Webhook
- Vercel Cron
- PWA Manifest + Service Worker

자세한 구조는 `ARCHITECTURE.md`를 참고하세요.

## 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

필요한 외부 설정은 다음 문서를 따릅니다.

- `docs/setup-supabase.md`
- `docs/setup-github-app.md`

## Harness

변경 완료 전 아래 검증을 통과해야 합니다.

```bash
npm run validate
npm run validate:git
npm run lint
npm run typecheck
npm run build
npm test
```

브랜치/커밋/PR 규칙은 `docs/git-conventions.md`, Coding Agent 공통 규칙은 `AGENTS.md`가 Source of Truth입니다.
