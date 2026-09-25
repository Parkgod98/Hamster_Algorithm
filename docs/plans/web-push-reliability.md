# Web Push 신뢰성 보강

## 문제
PR #13의 첫 구현은 사용자 단위 delivery row를 실제 Push 전송 전에 `보냄`으로 기록했습니다. 이 구조에서는 Apple/브라우저 Push endpoint 전송이 실패해도 같은 Study Day의 재시도가 unique constraint에 막힐 수 있습니다. 또한 사용자의 다른 기기 구독이 하나라도 있으면 현재 iPhone이 실제로 구독되지 않았어도 UI가 `알림 켜짐`으로 보일 수 있습니다.

알림 실패가 GitHub webhook/수동 인증의 본 기능을 실패시키거나 한 사용자의 오류가 reminder cron 전체를 중단시켜서도 안 됩니다.

## 수정 원칙
- 중복 방지는 사용자 단위가 아니라 **기기 subscription 단위**로 적용합니다.
- delivery는 `pending → sent/failed` 상태를 기록하고, 실제 전송 성공 뒤에만 `sent_at`을 기록합니다.
- `failed` 또는 일정 시간 이상 멈춘 `pending`은 재시도할 수 있게 합니다.
- 404/410 endpoint는 구독을 제거하고, 일시 실패는 같은 요청에서 한 번 재시도합니다.
- Push 오류는 풀이 저장과 인증 API의 성공 여부에 영향을 주지 않습니다.
- reminder cron은 멤버별 오류를 격리하고 `checked/eligible/attempted/sent/failed/expired/skipped/errors` 요약을 로그와 응답에 남깁니다.
- 현재 기기 endpoint 기준으로 `알림 켜짐`을 판정합니다.
- VAPID key가 바뀐 기존 subscription은 다시 구독하도록 처리합니다.
- 사용자가 iPhone/Android에서 즉시 확인할 수 있는 `테스트 알림 보내기`를 제공합니다.

## 스케줄
Vercel Hobby Cron의 분 단위 정각 실행에 의존하지 않습니다. 21:00 KST 이후부터 Study Day 종료 전까지 여러 reminder cron을 두고, 호출이 들어오는 즉시 미인증 여부를 판정해 전송합니다. 기기별 delivery 멱등 처리로 이미 성공한 기기에는 중복 발송하지 않고 실패/미발송 기기만 재시도합니다.

## DB migration
적용된 `202609140001_add_push_notifications.sql`은 수정하지 않고 새 migration을 추가합니다.
- `hamster_notification_deliveries.subscription_id`
- `status`, `attempt_count`, `attempted_at`, `last_error`, `last_status_code`
- `sent_at` nullable 전환
- 기존 사용자 단위 unique constraint 제거
- `(study_id,user_id,study_date,kind,subscription_id)` 기기 단위 unique index 추가

## 검증
- Repository Harness 전체
- notification retry/dedupe pure rule 테스트
- 기존 알림 문구/완료·미루기 판정 회귀 테스트
- Vercel Preview 및 PR CI 확인
