# Hamster Algorithm Agent Guide

이 파일은 모든 Coding Agent가 공유하는 프로젝트 규칙의 진입점입니다. 세부 규칙의 Source of Truth는 `docs/`입니다.

## 작업 전 반드시 읽기
1. `docs/product-spec.md`
2. `ARCHITECTURE.md`
3. `docs/git-conventions.md`
4. `docs/work-logs/README.md`와 가장 최근 작업 로그
5. 현재 작업과 관련된 `docs/plans/` 문서가 있으면 해당 문서

## 제품 원칙
- 햄쮸터 규칙을 코드보다 우선하는 도메인 규칙으로 취급합니다.
- Study Day는 Asia/Seoul 기준 오전 4시에 바뀝니다. 단순 자정 기준으로 계산하지 않습니다.
- GitHub Repository는 풀이 이벤트의 입력 Source이며 사용자의 풀이 이력 자체가 아닙니다.
- 사용자와 Repository는 1:N입니다. 한 Study 안에서도 멤버마다 서로 다른 Repository를 연결할 수 있습니다.
- GitHub webhook은 재전송될 수 있으므로 `source_event_id`와 `delivery_id`로 반드시 멱등 처리합니다.
- GitHub App, Supabase service role key, webhook secret 등 비밀값은 저장소에 커밋하지 않습니다.
- UI에서 내부 Repository ID, installation token, DB 오류 원문을 그대로 노출하지 않습니다.

## 개발 원칙
- Next.js App Router + TypeScript를 사용합니다.
- 기본은 Server Component이며 브라우저 상호작용이 필요한 경우에만 Client Component를 사용합니다.
- Hamster Algorithm은 MyScheduler와 같은 Supabase project를 공유하므로 앱 소유 DB object는 반드시 `hamster_` prefix를 사용합니다.
- DB table 이름은 `src/lib/db.ts`를 단일 진입점으로 사용하며 API 코드에서 물리 테이블 이름을 임의로 하드코딩하지 않습니다.
- Hamster migration에서 `public.` object를 참조할 때는 반드시 `hamster_` prefix를 사용하며 MyScheduler object를 참조하거나 변경하지 않습니다.
- DB 변경은 `supabase/migrations/`에 새 migration으로 추가하고 적용된 migration을 수정하지 않습니다.
- GitHub 이벤트 파싱과 규칙 판정은 `src/lib/`의 순수 함수에 최대한 모읍니다.
- 외부 서비스 실패가 풀이 이력을 조용히 유실시키지 않도록 webhook 원본 delivery를 먼저 기록합니다.
- GitHub API token은 installation access token으로 짧게 발급해 사용하고 DB에 장기 저장하지 않습니다.

## Harness
변경 완료 전 아래를 실행합니다.

```bash
npm run validate
npm run validate:git
npm run validate:supabase
npm run lint
npm run typecheck
npm run build
```

규칙 엔진을 변경한 경우 테스트도 실행합니다.

```bash
npm test
```

`validate:supabase`는 API의 물리 테이블 하드코딩과 `hamster_` prefix가 없는 public DB object 참조를 실패 처리합니다. CI 실패를 무시하거나 검증 코드를 삭제해 통과시키지 않습니다.

## Git
- `main` 직접 작업 금지. 최초 bootstrap만 예외입니다.
- 브랜치: `<type>/<english-kebab-case>`
- 커밋: `<type>: <한글로 구체적인 설명>`
- PR 제목: `<type>: <한글 설명>`이며 브랜치 type과 일치해야 합니다.
- 기본 Merge 방식은 Squash merge입니다.
- Push/PR 생성은 사용자가 요청하면 수행하고 Merge는 별도 명시가 없으면 사용자가 직접 합니다.

## 작업 로그
의미 있는 작업은 `docs/work-logs/YYYY-MM-DD.md`에 Asia/Seoul 기준으로 기록합니다.
