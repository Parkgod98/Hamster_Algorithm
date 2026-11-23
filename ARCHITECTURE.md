# Architecture

## Runtime
- UI: Next.js App Router + React + TypeScript
- Auth / DB: 햄쮸터 세션, 기존 GitHub OAuth 회원 전환, Supabase PostgreSQL + RLS
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
- `auth.users`의 UUID는 풀이와 멤버십의 기존 참조를 유지합니다. 신규 회원은 아이디·닉네임·비밀번호·복구 질문 하나로 가입합니다.
- 비밀번호와 복구 답변은 salt를 넣어 해시하고 햄쮸터 계정에 보관합니다. 서버는 기기별 세션 토큰의 해시를 확인합니다. 직접 로그아웃하면 해당 세션이, 복구로 비밀번호를 변경하면 이전 세션 전체가 종료됩니다.
- 기존 회원은 GitHub OAuth로 신원을 확인하고 동일한 UUID에 새 로그인 방법을 등록합니다. 개인 저장소 연결은 가입 후 선택합니다.
- `hamster_profiles`의 닉네임은 참여한 모든 스터디에 적용되며 중복을 허용합니다.
- `hamster_studies`는 스터디와 마지막으로 저장한 설정을 보관합니다. 날짜별 판정에는 규칙 이력을 사용합니다.
- `hamster_study_members`는 사용자와 스터디의 N:M 관계와 admin/member 역할을 보관합니다. 스터디장이 규칙을 수정하고 멤버는 조회합니다.
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

스터디장이 필요 문제 수를 변경하면 각 구간 credit을 `1 / 필요 문제 수`로 계산합니다. `normalizeRuleConfig`가 DB JSON을 검증하고 누락/비정상 값은 기본값으로 보정합니다. 1 credit을 채우면 알고리즘 목표를 달성합니다. 하루 인증에는 해당 날짜의 허용 목표와 전부 또는 N개 조건을 적용합니다.

스터디 생성 트랜잭션에서 실제 개설 설정을 첫 인증일 이력으로 저장합니다. 설정 변경 RPC는 스터디장 권한을 확인하고 다음 인증일의 예약과 마지막 설정을 함께 저장합니다. 같은 적용일의 예약을 다시 저장할 때는 이전 값을 `hamster_superseded_rule_versions`에 보관합니다. 달력, 미루기, 알림, 벌금 계산은 대상 날짜까지 적용된 가장 최근 이력을 사용합니다. 적용할 이력이 누락된 경우 계산 오류를 반환해 임의 금액이 확정되는 일을 막습니다.

서로 다른 난이도를 섞어 푼 경우 credit 합산으로 판정하는 것은 원문에 명시되지 않은 제품 해석이며 `docs/product-spec.md`에 명시합니다.

## Obligation backlog / Postpone / Pre-solve / Penalty
Rule Engine은 날짜별 상태를 독립적인 면제 여부로 보지 않고 `1 Study Day = 1 obligation`으로 계산합니다.

- 각 참여 Study Day마다 1.0 obligation을 FIFO queue에 추가합니다.
- Submission credit은 발생한 Study Day 시점에 queue의 가장 오래된 미해결 obligation부터 사용합니다.
- 한 obligation이 1.0을 모두 받아야 그 날짜가 `complete`가 됩니다. 0.5만 채운 상태는 부분 상환일 뿐 미해결 obligation 개수는 줄지 않습니다.
- `hamster_postponements` row는 obligation을 삭제하지 않습니다. 해당 날짜를 벌금 없이 이월할 수 있게 하는 이력입니다.
- 과거 postponed obligation이 나중 Submission으로 완전히 상환되면 현재 계산 상태는 `complete`가 되지만 postponement row는 그대로 유지합니다.
- 기본 `max_consecutive_postpone=2`에서는 현재 Study Day까지 미해결 obligation이 2개 이하일 때만 오늘 postpone을 새로 기록할 수 있습니다. 3개라면 최소 1개를 완전히 상환해야 합니다.
- backlog가 모두 해결된 뒤 남는 credit만 carry lot이 되어 해당 날짜의 `max_presolve_days` 동안 미래 obligation을 선풀이할 수 있습니다.
- carry lot은 `earnedOn`을 유지하며 만료 후에는 미래 obligation에 사용할 수 없습니다.
- 미루기를 신청하지 않은 날짜가 04:00에 마감될 때 현재 미해결 obligation 개수가 벌금 단계가 됩니다. 1개=1회, 2개=2회, 3개 이상=3회 최고 단계입니다.
- `hamster_penalties`는 확정 이력입니다. 이후 과거 obligation을 상환해도 이미 저장된 penalty row를 수정하거나 삭제하지 않습니다.

이 계산은 Dashboard, postpone API, penalty cron, completion/reminder Push가 모두 동일한 `src/lib/progress.ts` 엔진을 사용하도록 유지합니다.

## Web Push
- `hamster_push_subscriptions`: 사용자 기기별 endpoint, `p256dh`, `auth` key를 저장합니다.
- `hamster_notification_preferences`: 인증 완료/23:30 reminder 알림의 사용자별 on/off를 저장합니다.
- `hamster_notification_deliveries`: 기기 subscription 단위 delivery 상태로 같은 알림의 성공 후 중복 전송을 막습니다.
- 브라우저는 Service Worker의 `PushManager`로 subscription을 만들고 인증 API `/api/push/subscriptions`를 통해 서버에 저장합니다.
- VAPID public key만 client에 전달하며 private key는 서버 환경변수로 유지합니다.
- GitHub webhook과 수동 인증 API는 제출 전/후 현재 Study Day 상태를 계산하고 backlog와 오늘 obligation이 모두 해결되어 `미완료 → 완료` 전환일 때만 completion Push를 요청합니다.
- `/api/cron/remind`는 21:00 KST 이후 Study Day 종료 전 delivery window에서 호출되는 즉시 현재 Study Day까지 미해결 obligation이 남으면서 오늘 postpone을 사용하지 않은 사용자에게만 발송합니다. 여러 backup cron이 호출되어도 성공 delivery는 기기 단위로 중복 전송하지 않습니다.
- Push 실패는 풀이 저장을 실패시키지 않고 delivery 상태를 통해 재시도합니다.
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
- 사용자 API는 서버에서 햄쮸터 세션을 확인해 user id를 결정합니다. 기존 회원 전환에는 기존 Supabase 로그인 증명을 사용합니다.
- 성장 통계 API는 요청자의 Study membership을 확인하고 대상 user가 같은 Study 멤버일 때만 submission을 조회합니다. service role을 사용하더라도 이 서버 권한 검증을 생략하지 않습니다.
- 규칙 변경 API는 로그인 사용자의 ID를 전달하고, 저장 트랜잭션에서 해당 스터디의 스터디장 권한을 확인합니다.
- Push endpoint/key는 server-only table에 저장하고 authenticated direct RLS policy를 열지 않습니다.
- 재시도에 필요한 webhook payload는 서버 전용 수신 기록에 저장합니다. 풀이 저장과 수신 완료를 한 트랜잭션에 기록한 뒤 payload를 비웁니다.
- 공유 Supabase project의 다른 앱 object에는 Hamster migration이 접근하지 않습니다.


## Runtime efficiency
현재 규모에서는 별도 cache server나 집계 저장소를 두지 않고 요청 단위 재사용과 bounded query를 우선합니다.

- 개인 풀이 성장 통계는 선택 월을 포함한 최근 3개월 Study Day 범위만 DB에서 읽고, 브라우저에서는 사용자/Study/월 단위로 5분간 결과를 재사용합니다.
- 수동 인증과 backfill처럼 풀이 기록을 직접 변경한 경우 해당 사용자/Study의 성장 통계 cache를 즉시 무효화합니다.
- 진행 상태 계산은 같은 요청 안에서 Study, 규칙 버전, 풀이, 미루기 context를 한 번 읽은 뒤 before/after 판정에 재사용합니다.
- reminder cron은 멤버마다 DB를 다시 읽지 않고 Study 단위 context로 묶어서 계산하며, 활성 Push subscription이 없거나 reminder가 꺼져 있거나 현재 모든 기기에 이미 성공 전송된 사용자는 진행 상태 계산 전에 제외합니다.
- Dashboard와 penalty finalize는 사용자별로 submission/postponement/penalty를 먼저 그룹핑해 전체 배열을 멤버 수만큼 반복 순회하지 않습니다.
- 달력은 일별 풀이 집계와 적용 규칙, 수동 목표 완료일, 미루기 이력을 읽습니다. 벌금 상세와 풀이 제목, 설정 변경자, 저장소 목록, 성장 통계는 각 화면에서 조회합니다. 미루기 저장 응답을 받으면 오늘 칸을 즉시 갱신합니다.
- FIFO progress engine은 가장 오래된 미해결 obligation pointer와 backlog count를 유지해 과거 obligation 전체를 날짜마다 다시 순회하지 않습니다.
- Repository backfill은 GitHub commit detail 요청을 최대 8개 동시 처리하고, problem/submission은 page 단위 일괄 저장합니다.

이 최적화는 Source of Truth나 도메인 판정 결과를 변경하지 않습니다. Redis, materialized view, 별도 worker/queue는 현재 범위에 포함하지 않습니다.
