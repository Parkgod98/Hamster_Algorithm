# 모바일 Web Push 알림

## 목표
- 자동/수동 풀이로 현재 Study Day가 처음 완료되는 순간 해당 사용자 기기에 인증 완료 Push를 보냅니다.
- 매일 23:30 KST에 현재 Study Day가 미완료이고 미루기도 하지 않은 사용자에게 한 번만 Push를 보냅니다.
- Android Chrome/PWA와 iPhone 홈 화면 PWA를 같은 Web Push 표준으로 지원합니다.

## 알림 문구
- 완료: `🐹 오늘 인증 완료! 수고했다 쮸!`
- 미인증: `🐹 아직 오늘 인증이 안 됐어. 04:00 전까지 풀거나 미루기 신청해줘! 쮸!`

## 데이터
- `hamster_push_subscriptions`: 기기별 Web Push endpoint와 암호화 key
- `hamster_notification_preferences`: 사용자별 완료/미인증 알림 설정
- `hamster_notification_deliveries`: Study Day/알림 종류별 중복 전송 방지

모든 object는 Shared Supabase 격리 규칙에 따라 `hamster_` prefix를 사용합니다. Push endpoint/key는 서버 API에서만 읽고 쓰며 RLS를 활성화한 채 authenticated 직접 policy를 두지 않습니다.

## 동작
1. 사용자가 PWA에서 `알림 켜기`를 누르면 브라우저 권한을 요청하고 Push subscription을 서버에 등록합니다.
2. GitHub webhook 또는 수동 인증 전/후의 현재 Study Day 상태를 비교합니다.
3. `미완료 → 완료`로 전환된 경우에만 완료 Push를 한 번 전송합니다.
4. Vercel Cron이 매일 14:30 UTC(23:30 KST)에 reminder endpoint를 호출합니다.
5. reminder는 현재 Study Day가 `complete/presolved/postponed`가 아닌 사용자만 대상으로 합니다.
6. 만료된 endpoint(404/410)는 자동 삭제합니다.
7. 알림을 누르면 `/dashboard`를 열거나 기존 Dashboard 탭에 focus합니다.

## iPhone
Web Push는 홈 화면에 추가된 PWA에서 사용자가 직접 알림 권한을 허용해야 합니다. 일반 Safari 탭에서는 홈 화면 설치 안내를 우선 표시합니다.

## 환경변수
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

VAPID private key는 Repository에 커밋하지 않습니다.
