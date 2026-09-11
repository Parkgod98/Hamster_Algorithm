# Supabase Setup

Hamster Algorithm은 Free plan 프로젝트 한도 때문에 **MyScheduler의 기존 Supabase project를 공유**합니다. MyScheduler의 기존 테이블과 기능을 건드리지 않도록 Hamster 소유 DB object는 모두 `hamster_` prefix를 사용합니다.

## 1. 사용할 기존 project 확인
MyScheduler가 현재 연결된 Supabase project를 그대로 사용합니다. 새 project를 만들거나 기존 project를 Pause할 필요가 없습니다.

## 2. Migration 적용
`supabase/migrations/202609110001_initial_schema.sql`을 해당 project의 SQL Editor에서 실행합니다.

생성되는 주요 object:
- `hamster_profiles`
- `hamster_studies`
- `hamster_study_members`
- `hamster_github_installations`
- `hamster_repository_connections`
- `hamster_problems`
- `hamster_submissions`
- `hamster_postponements`
- `hamster_penalties`
- `hamster_webhook_events`
- `hamster_is_study_member(...)`

기존 MyScheduler table/policy/function 이름을 재사용하지 않습니다.

## 3. GitHub OAuth provider
Supabase Dashboard의 Authentication > Providers에서 GitHub provider를 활성화합니다.

기존 MyScheduler 인증 provider는 그대로 둡니다. 한 Supabase project에서 여러 provider를 함께 사용할 수 있습니다.

Hamster 배포 주소가 정해지면 Authentication > URL Configuration의 Redirect URLs에 다음 형식을 추가합니다.

```text
https://<hamster-vercel-domain>/auth/callback
```

로컬 개발을 할 경우 아래도 추가합니다.

```text
http://localhost:3000/auth/callback
```

기존 MyScheduler Redirect URL은 삭제하거나 수정하지 않습니다.

## 4. Hamster 환경변수
Hamster Vercel project에는 MyScheduler와 같은 Supabase project의 값을 사용합니다.

```text
NEXT_PUBLIC_SUPABASE_URL=<shared project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<shared project anon key>
SUPABASE_SERVICE_ROLE_KEY=<shared project service role key>
```

`SUPABASE_SERVICE_ROLE_KEY`는 Vercel server environment에만 저장하고 브라우저 코드나 GitHub에 커밋하지 않습니다.

## 5. 격리 원칙
- Hamster application table/function/policy: `hamster_` prefix
- `auth.users`: 두 앱이 같은 Supabase Auth tenant를 공유
- 브라우저 session: 앱 도메인이 다르므로 각 앱 origin에서 별도로 저장
- server-only table(`hamster_github_installations`, `hamster_webhook_events`): RLS를 켜고 authenticated policy를 만들지 않음
- server 작업은 service role을 사용하되 key는 server에서만 사용

## 6. 확인
Migration 적용 후 Table Editor에서 `hamster_`로 시작하는 table만 새로 생겼는지 확인합니다. 기존 MyScheduler table에는 schema 변경이 없어야 합니다.
