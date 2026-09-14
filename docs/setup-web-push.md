# Web Push Setup

## 1. Supabase migration
`supabase/migrations/202609140001_add_push_notifications.sql`을 Shared Supabase project의 SQL Editor에서 실행합니다.

## 2. VAPID key 생성
로컬에서 `npx web-push generate-vapid-keys`를 실행해 public/private key를 생성합니다.

키 자체는 Repository에 커밋하지 않습니다.

## 3. Vercel 환경변수
Production/Preview에 다음 값을 등록합니다.

- `WEB_PUSH_VAPID_PUBLIC_KEY`: 생성된 Public Key
- `WEB_PUSH_VAPID_PRIVATE_KEY`: 생성된 Private Key
- `WEB_PUSH_VAPID_SUBJECT`: 운영 담당자 연락처. 예: `mailto:example@example.com`

기존 `CRON_SECRET`도 유지되어야 합니다.

## 4. 모바일 사용
- Android Chrome/PWA: Dashboard의 🔔에서 `알림 켜기`를 누르고 브라우저 권한을 허용합니다.
- iPhone: Safari에서 햄쮸터를 홈 화면에 추가한 뒤 홈 화면의 햄쮸터 PWA로 열고 🔔 → `알림 켜기`를 눌러 권한을 허용합니다.

## 5. 동작 시간
- 인증 완료: 자동/수동 풀이 반영으로 현재 Study Day가 처음 완료되는 순간
- 미인증 reminder: 매일 23:30 Asia/Seoul (`30 14 * * *` UTC)
- Study Day 종료/벌금 확정: 기존 04:05 Asia/Seoul cron 유지

미인증 reminder는 완료 또는 미루기 상태면 발송하지 않습니다.
