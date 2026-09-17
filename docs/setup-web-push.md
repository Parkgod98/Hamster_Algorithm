# Web Push Setup

## 1. Supabase migration
초기 Push migration과 신뢰성 보강 migration을 순서대로 적용합니다.

1. `supabase/migrations/202609140001_add_push_notifications.sql`
2. `supabase/migrations/202609170001_harden_push_deliveries.sql`

이미 첫 migration을 적용한 운영 DB에서는 두 번째 migration만 추가 실행합니다. 적용된 migration 파일은 수정하지 않습니다.

## 2. VAPID key 생성
로컬에서 `npx web-push generate-vapid-keys`를 실행해 public/private key를 생성합니다.

키 자체는 Repository에 커밋하지 않습니다.

## 3. Vercel 환경변수
Production/Preview에 다음 값을 등록합니다.

- `WEB_PUSH_VAPID_PUBLIC_KEY`: 생성된 Public Key
- `WEB_PUSH_VAPID_PRIVATE_KEY`: 생성된 Private Key
- `WEB_PUSH_VAPID_SUBJECT`: 운영 담당자 연락처 또는 서비스 URL

기존 `CRON_SECRET`도 유지되어야 합니다.

VAPID key를 교체하면 기존 브라우저 subscription이 이전 application server key와 연결되어 있을 수 있습니다. Dashboard가 이를 감지하면 현재 기기의 알림을 다시 켜도록 안내합니다.

## 4. 모바일 사용
- Android Chrome/PWA: Dashboard의 🔔에서 `이 기기 알림 켜기`를 누르고 브라우저 권한을 허용합니다.
- iPhone: Safari에서 햄쮸터를 홈 화면에 추가한 뒤 홈 화면의 햄쮸터 PWA로 열고 🔔 → `이 기기 알림 켜기`를 눌러 권한을 허용합니다.
- 알림을 켠 직후 `테스트 알림 보내기`를 눌러 실제 기기 Push 수신까지 확인합니다.

설정의 `알림 켜짐` 여부는 계정의 다른 기기가 아니라 현재 기기의 endpoint 등록 여부를 기준으로 표시합니다.

## 5. reminder 동작 시간
- 인증 완료: 자동/수동 풀이 반영으로 현재 Study Day가 처음 완료되는 순간
- 미인증 reminder primary: `30 14 * * *` UTC
- 미인증 reminder backup: `0 15 * * *` UTC
- Study Day 종료/벌금 확정: 기존 `5 19 * * *` UTC

Vercel Hobby Cron은 일 단위 작업을 분 단위 정각으로 보장하지 않습니다. 따라서 primary와 backup을 함께 등록하고 서버에서 23:30 KST 이전 실행은 차단합니다. 이미 해당 Study Day에 특정 기기로 성공한 reminder는 backup 실행에서 중복 전송하지 않습니다. 실패한 기기는 다시 시도할 수 있습니다.

## 6. 실패 처리
- 실제 Push 성공 후에만 delivery 상태를 `sent`로 확정합니다.
- 일시 오류(네트워크, 408, 429, 5xx)는 같은 요청에서 한 번 재시도합니다.
- 실패 상태는 다음 reminder 실행에서 다시 시도할 수 있습니다.
- 404/410 endpoint는 만료된 subscription으로 보고 제거합니다.
- Push 실패는 GitHub 자동 인증이나 수동 인증 저장 자체를 실패시키지 않습니다.
- reminder cron 응답과 Vercel runtime log에는 `checked`, `eligible`, `attempted`, `sent`, `failed`, `expired`, `skipped`, `errors` 요약을 남깁니다.
