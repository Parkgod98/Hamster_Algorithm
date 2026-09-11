# Architecture

## Runtime
- UI: Next.js App Router + React + TypeScript
- Auth / DB: Supabase Auth + PostgreSQL + RLS
- Repository ingestion: GitHub App + push webhook
- Installability: Web App Manifest 기반 PWA
- Optional manual ingestion: 인증된 API endpoint. 향후 Chrome Extension/SWEA/CodeTree adapter가 사용

## Core topology

```text
각 사용자 GitHub Repository
        │ push
        ▼
     GitHub App
        │ webhook
        ▼
/api/github/webhook
        │
        ├─ delivery 멱등 처리
        ├─ Repository → User/Study 매핑
        ├─ BaekjoonHub 경로/커밋 정규화
        └─ Submission 저장
                 │
                 ▼
          Study Rule Engine
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
 Daily Progress        Postpone/Penalty
       │
       ▼
    PWA Dashboard
```

## Identity model
- `auth.users`: 로그인 Identity. Supabase GitHub OAuth를 기본 로그인으로 사용합니다.
- `profiles`: GitHub login 등 화면용 프로필.
- `studies`: 스터디와 공통 규칙.
- `study_members`: User와 Study의 N:M 관계.
- `repository_connections`: 사용자별 연결 Repository. 한 사용자가 여러 Repository를 연결할 수 있습니다.
- `github_installations`: GitHub App 설치와 사용자 연결.

## Submission model
모든 입력 Source를 내부 `Submission`으로 정규화합니다.

```text
platform: BOJ | PROGRAMMERS | SWEA | CODETREE
problem external id
difficulty
solved_at
source: github | manual | extension
source_event_id
repository_connection(optional)
```

GitHub 경로나 폴더 구조를 도메인 모델로 사용하지 않습니다. Adapter가 외부 표현을 정규화한 뒤 Rule Engine은 정규화 데이터만 사용합니다.

## Study Day
Asia/Seoul 기준 04:00을 날짜 경계로 사용합니다.

- 2026-09-12 03:59 → 2026-09-11 Study Day
- 2026-09-12 04:00 → 2026-09-12 Study Day

DB에는 원본 `solved_at`을 timestamptz로 저장하고 Study Day는 서버에서 계산합니다.

## Rule Engine
기본 햄쮸터 규칙을 credit으로 정규화합니다.

- BOJ Bronze 2~1: 1/3 credit
- BOJ Silver 5~1: 1/2 credit
- BOJ Gold 5 이상: 1 credit
- Programmers Lv.0~1: 1/3 credit
- Programmers Lv.2 이상: 1 credit
- SWEA D2~D3: 1/2 credit
- SWEA D4 이상: 1 credit
- CodeTree 삼성 기출: 1 credit

1 credit 이상이면 하루 완료입니다. 서로 다른 난이도를 섞어 푼 경우 credit 합산으로 판정하는 것은 원문에 명시되지 않은 제품 해석이며 `docs/product-spec.md`에 명시합니다.

## Pre-solve
초과 credit은 최대 2개의 다음 Study Day로 carry할 수 있습니다. carry는 오래된 credit부터 소비하고 2일을 넘긴 credit은 만료시킵니다.

## Postpone
- 신청 마감: 당일 23:59 Asia/Seoul
- 연속 최대 2회
- postpone된 날은 1 credit 요구량을 소비하지 않습니다.

## Penalty
미제출 연속 일수에 따라 기본 금액을 계산합니다.
- 1일: 10,000원
- 2일: 25,000원
- 3일: 50,000원
- 3일 초과 정책은 확정되지 않았으므로 자동 금액을 임의 확장하지 않습니다.

## Security boundary
- GitHub webhook은 HMAC SHA-256 signature를 검증합니다.
- GitHub App private key와 Supabase service role key는 서버 전용 환경변수입니다.
- 사용자 API는 Supabase access token을 검증한 뒤 user id를 결정합니다.
- webhook payload는 필요한 최소 메타데이터만 DB에 저장합니다.
