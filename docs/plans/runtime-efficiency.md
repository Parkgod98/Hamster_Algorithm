# Runtime Efficiency Refactor

## 목표
현재 동작과 데이터 모델을 유지하면서 반복 조회, 전체 이력 스캔, 중복 계산, 순차 I/O를 줄입니다. Redis, 별도 집계 DB, materialized view, queue/worker 도입은 하지 않습니다.

## 범위

### P0
1. 풀이 성장 통계 월별 클라이언트 캐시와 5분 TTL
2. 풀이 성장 API를 최근 3개월에 필요한 Study Day 범위만 조회
3. 진행 상태 계산용 Study/User context를 한 번 로드해 같은 요청에서 재사용
4. reminder cron을 Study 단위 bulk load 후 멤버별 메모리 계산으로 변경
5. FIFO progress engine의 과거 obligation 반복 스캔 제거

### P1
6. Dashboard는 backlog 정합성을 깨지 않는 범위에서 조회 상한/필드를 줄임
7. Dashboard submissions/postponements/penalties를 userId별로 한 번 그룹핑
8. finalize cron도 userId별 그룹핑 및 target day penalty 선조회
9. reminder backup 실행에서 이미 모든 현재 기기에 성공 전송됐거나 알림 대상이 없는 사용자는 progress 계산 전 skip
10. GitHub webhook completion 전/후 판정에서 같은 progress context 재사용
11. 수동 인증 completion 전/후 판정에서 같은 progress context 재사용
12. backfill은 GitHub commit detail 제한 동시성과 Supabase batch upsert/insert 사용

## 보존해야 하는 동작
- Study Day는 Asia/Seoul 04:00 경계입니다.
- 미루기/backlog/선풀이/벌금 FIFO 규칙은 변경하지 않습니다.
- 과거 backlog 때문에 Dashboard/진행 상태 계산에 필요한 역사 데이터는 임의로 잘라내지 않습니다.
- completion Push는 미완료에서 현재 Study Day까지 완전 완료로 전환될 때만 보냅니다.
- reminder의 기기별 성공 중복 방지와 실패 재시도 의미를 유지합니다.
- webhook의 delivery/source_event 멱등성을 유지합니다.
- 기존 DB schema는 변경하지 않습니다.

## 구현 원칙
- DB table 이름은 `src/lib/db.ts`를 사용합니다.
- 공통 progress loader/evaluator를 `src/lib/`에 두고 API가 같은 계산을 공유하게 합니다.
- 클라이언트 cache는 현재 앱 규모에 맞춘 메모리 Map으로 구현하고, 수동 인증/backfill 성공 시 invalidate합니다.
- Backfill 동시성은 과도하게 높이지 않고 8개로 제한합니다.
- 기능 변경이 아닌 성능 리팩터링이므로 기존 결과와 동일함을 테스트로 확인합니다.

## 검증
- 기존 Repository Harness 전체
- FIFO backlog 회귀 테스트
- 장기간 timeline 계산 테스트
- Study Day timestamp boundary 테스트
- Growth 최근 3개월 범위 집계 테스트
- PR CI / Vercel Preview
