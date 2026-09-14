# Architecture

## Runtime
- UI: Next.js App Router + React + TypeScript
- Auth / DB: Supabase Auth + PostgreSQL + RLS
- Supabase deployment: MyScheduler와 기존 Supabase project를 공유하되 Hamster 소유 object는 `hamster_` prefix로 격리
- Repository ingestion: GitHub App + push webhook
- Installability: Web App Manifest + Service Worker 기반 PWA
- Notification: Web Push + VAPID + Vercel Cron
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
       ┌─────────┼─────────┐
       ▼         ▼         ▼
 Daily Progress  Postpone  Web Push
       │         /Penalty     │
       ▼                     ▼
    PWA Dashboard      Android / iPhone PWA
```

## Shared Supabase isolation
Free plan의 별도 project를 추가하지 않고 MyScheduler의 기존 Supabase project를 공유합니다.

- `auth.users`만 Supabase Auth tenant 수준에서 공유합니다.
- Hamster가 소유하는 table/function/policy는 모두 `hamster_` prefix를 사용합니다.
- API의 물리 테이블 이름은 `src/lib/db.ts`에서 관리합니다.
- MyScheduler의 기존 table, function, policy 이름을 재사용하거나 변경하지 않습니다.
- `hamster_github_installations`, `hamster_webhook_events`, Push 관련 table은 RLS를 활성화한 뒤 authenticated 직접 policy를 두지 않아 server-only로 유지합니다.
- service role key와 VAPID private key는 Hamster 서버 환경변수에만 두며 client bundle에 포함하지 않습니다.

## Identity / session model
- `auth.users`: 로그인 Identity. Supabase GitHub OAuth를 기본 로그인으로 사용합니다. MyScheduler와 같은 auth tenant를 공유합니다.
- Browser/PWA는 Supabase session을 localStorage에 지속 저장하고 refresh token을 자동 갱신합니다.
- 로그인 전 화면은 기존 session이 있으면 `/dashboard`로 자동 이동합니다.
- session은 사용자가 설정에서 명시적으로 로그아웃할 때 종료합니다.
- `hamster_profiles`: GitHub login 등 화면용 프로필.
- `hamster_studies`: 스터디와 현재 공통 규칙. 문제 수/벌금은 `rule_config` JSONB, 미루기/선풀이 한도는 명시적 column으로 관리합니다.
- `hamster_study_members`: User와 Study의 N:M 관계와 admin/member role. 현재 인증 규칙 편집은 role에 관계없이 Study 참여원에게 허용합니다.
- `hamster_study_rule_versions`: 규칙의 Study Day별 effective snapshot과 변경자를 기록합니다.
- `hamster_repository_connections`: 사용자별 연결 Repository. 한 사용자가 여러 Repository를 연결할 수 있습니다.
- `hamster_github_installations`: GitHub App 설치와 사용자 연결.

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

DB에는 원본 `solved_at`을 timestamptz로 저장하고 Study Day는 서버에서 계산합니다. cutoff는 현재 04:05 KST penalty cron과 결합되어 있으므로 UI에서 변경하지 않습니다.

## Rule Engine / versioning
기본 햄쮸터 규칙은 다음 credit으로 시작합니다.

- BOJ Bronze 2~1: 1/3 credit
- BOJ Silver 5~1: 1/2 credit
- BOJ Gold 5 이상: 1 credit
- Programmers Lv.0~1: 1/3 credit
- Programmers Lv.2 이상: 1 credit
- SWEA D2~D3: 1/2 credit
- SWEA D4 이상: 1 credit
- CodeTree 삼성 기출: 1 credit

Study 참여원이 필요 문제 수를 변경하면 각 구간 credit을 `1 / 필요 문제 수`로 계산합니다. `normalizeRuleConfig`가 DB JSON을 검증하고 누락/비정상 값은 기본값으로 보정합니다. 1 credit 이상이면 하루 완료입니다.

규칙 저장 시 현재 Study Day를 `effective_from`으로 하는 `hamster_study_rule_versions` snapshot을 upsert합니다. Dashboard와 penalty cron은 각 대상 날짜에서 가장 최근 `effective_from <= target date`인 버전을 선택합니다. 따라서 규칙 변경 전 날짜는 이전 규칙, 변경일부터는 새 규칙을 사용합니다. 같은 Study Day에 여러 번 수정하면 그 날짜의 snapshot을 최신 값으로 갱신합니다.

서로 다른 난이도를 섞어 푼 경우 credit 합산으로 판정하는 것은 원문에 명시되지 않은 제품 해석이며 `docs/product-spec.md`에 명시합니다.

## Pre-solve / Postpone / Penalty
- 초과 credit은 해당 날짜의 `max_presolve_days` 범위 안에서 오래된 credit부터 carry합니다.
- 미루기 신청 시각과 연속 횟수는 현재 Study 설정값을 사용합니다.
- 미제출 1/2/3일 금액은 대상 날짜의 rule version에 저장된 `rule_config.penalties`를 사용합니다.
- 3일 초과 정책은 확정되지 않았으므로 자동 금액을 임의 확장하지 않습니다.
- 이미 `hamster_penalties`에 확정된 과거 벌금 row는 규칙 변경 시 소급 수정하지 않습니다.

## Web Push
- `hamster_push_subscriptions`: 사용자 기기별 endpoint, `p256dh`, `auth` key를 저장합니다.
- `hamster_notification_preferences`: 인증 완료/23:30 reminder 알림의 사용자별 on/off를 저장합니다.
- `hamster_notification_deliveries`: `(study_id,user_id,study_date,kind)` unique constraint로 같은 알림의 중복 전송을 막습니다.
- 브라우저는 Service Worker의 `PushManager`로 subscription을 만들고 인증 API `/api/push/subscriptions`를 통해 서버에 저장합니다.
- VAPID public key만 client에 전달하며 private key는 서버 환경변수로 유지합니다.
- GitHub webhook과 수동 인증 API는 제출 전/후 현재 Study Day 상태를 계산하고 `미완료 → 완료` 전환일 때만 completion Push를 요청합니다.
- `/api/cron/remind`는 매일 14:30 UTC(23:30 KST)에 실행하고 완료 또는 미루기 상태는 제외합니다.
- 404/410을 반환하는 만료 endpoint는 전송 시 제거합니다.
- iPhone은 홈 화면에 설치한 PWA에서 사용자 gesture로 알림 권한을 허용해야 합니다.

## PWA boundary
- manifest의 설치 시작 위치는 `/dashboard`, display는 `standalone`입니다.
- Chromium 설치용 192/512 PNG와 iOS Apple Touch Icon을 제공합니다.
- Service Worker는 navigation과 `/api/*`를 cache하지 않아 OAuth/session과 Study 데이터가 stale cache에 가려지지 않게 합니다.
- 정적 asset만 network-first + cache fallback으로 보조합니다.
- Service Worker는 `push`에서 알림을 표시하고 `notificationclick`에서 `/dashboard`를 열거나 기존 창을 focus합니다.
- `validate:pwa`가 manifest, iOS metadata, icon, cache boundary, Push event handler를 CI에서 정적 검증합니다.

## Security boundary
- GitHub webhook은 HMAC SHA-256 signature를 검증합니다.
- GitHub App private key, Supabase service role key, VAPID private key는 서버 전용 환경변수입니다.
- 사용자 API는 Supabase access token을 검증한 뒤 user id를 결정합니다.
- Study rule 변경 API는 로그인 사용자가 해당 Study의 참여원인지 확인합니다.
- Push endpoint/key는 server-only table에 저장하고 authenticated direct RLS policy를 열지 않습니다.
- webhook payload는 필요한 최소 메타데이터만 DB에 저장합니다.
- 공유 Supabase project의 다른 앱 object에는 Hamster migration이 접근하지 않습니다.
