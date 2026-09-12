# Product Spec

## 문제
현재 스터디원은 BaekjoonHub가 GitHub에 자동 커밋한 결과를 다시 캡처하고 Notion에 올려 인증합니다. 실제 풀이 기록은 이미 GitHub에 있는데 사람이 같은 사실을 다시 옮기고 있습니다.

Hamster Algorithm은 각자의 Repository에서 발생한 풀이 이벤트를 자동 수집해 스터디 규칙으로 판정하고, 인증/미루기/미리 풀기/벌금/통계를 한 화면에서 관리하는 PWA를 목표로 합니다.

## 사용자 흐름
1. GitHub OAuth로 최초 로그인합니다. 이후 직접 로그아웃하기 전까지 저장된 Supabase session을 복원해 바로 Dashboard로 진입합니다.
2. 햄쮸터 Study를 만들거나 초대 코드/링크로 참여합니다.
3. GitHub App을 설치하고 자신의 알고리즘 Repository만 선택합니다.
4. 이후 문제를 평소처럼 풀고 BaekjoonHub가 push하면 자동 인증됩니다.
5. Dashboard의 월간 캘린더에서 같은 Study 멤버의 인증 상태와 풀이 내역을 확인합니다.
6. 모바일에서는 월간/주간 보기를 전환할 수 있습니다.
7. 통계 탭에서 멤버별 월간 인증률, 완료/미제출/미루기, 연속 인증, 누적 벌금을 확인합니다.
8. 못 푸는 날은 설정된 미루기 마감 전 미루기를 신청합니다.
9. Study 참여원 누구나 설정에서 문제 수, 미루기/선풀이 한도, 벌금 규칙을 조정할 수 있습니다.

## 기본 햄쮸터 규칙
- BOJ Bronze 2~1: 3문제
- BOJ Silver 5~1: 2문제
- BOJ Gold 5 이상: 1문제
- SWEA D2~D3: 2문제
- SWEA D4 이상: 1문제
- Programmers Lv.0~1: 3문제
- Programmers Lv.2 이상: 1문제
- CodeTree 삼성 기출: 1문제
- 제출 마감: 오전 4시
- 미루기 신청 마감: 당일 23:59
- 미루기: 연속 최대 2회
- 미리 풀기: 최대 2일
- 미제출 벌금: 1일 10,000원 / 2일 연속 25,000원 / 3일 연속 50,000원

## Study별 규칙 설정
기본값은 위 원문 규칙을 그대로 사용하되 해당 Study 참여원이라면 누구나 다음 값을 변경할 수 있습니다.

- 플랫폼/난이도 구간별 하루 필요 문제 수
- 미루기 신청 마감 시각
- 연속 미루기 최대 횟수
- 미리 풀기 최대 일수
- 미제출 1/2/3일 벌금

Study Day 경계인 04:00은 현재 운영 cron의 04:05 확정 시점과 결합되어 있으므로 임의 변경을 허용하지 않습니다. cutoff를 바꾸려면 cron 스케줄까지 함께 설계·변경해야 합니다.

규칙은 `hamster_study_rule_versions`에 Study Day 단위로 버전이 기록됩니다. 변경일 이전 날짜는 이전 규칙, 변경일 이후 날짜는 새 규칙으로 계산합니다. 같은 Study Day에 여러 번 저장하면 해당 날짜의 최신 설정으로 갱신합니다. 이미 `hamster_penalties`에 확정된 과거 벌금 row는 자동 소급 수정하지 않습니다.

## 제품 해석이 필요한 부분
원문에는 서로 다른 난이도/플랫폼 문제를 같은 날 섞어 풀었을 때의 합산 규칙이 없습니다. 문제별 필요량의 역수를 credit으로 계산해 합이 1 이상이면 완료로 판정합니다. 예: 기본 규칙에서 Silver 1문제(0.5) + Bronze 2문제(0.666...)도 완료입니다.

A형 취득자의 BOJ 최소 난이도 Silver 3 규칙은 멤버별 자격 속성이 필요하므로 `hamster_study_members.boj_minimum_difficulty` 필드를 두었으며 실제 판정/UI 적용은 후속 범위입니다.

## PWA / 반복 사용 UX
- Web App Manifest의 `display: standalone`과 `/dashboard` start URL을 사용합니다.
- Chromium 계열은 install prompt를 이용하고 iOS Safari는 `홈 화면에 추가` 안내를 제공합니다.
- Service Worker는 인증 API와 navigation을 cache하지 않습니다.
- 로그인 session은 localStorage에 유지하고 refresh token을 자동 갱신합니다.
- 사용자가 설정에서 직접 로그아웃하면 session을 종료합니다.

## MVP 범위
- GitHub OAuth 로그인 및 session 유지
- Study / Member / Repository 연결 schema
- 첫 사용 onboarding과 초대 코드 참여
- GitHub App 설치와 push webhook 수집
- BaekjoonHub BOJ / Programmers 자동 파싱
- Study Day(04:00) 판정
- credit 기반 하루 완료 판정
- 미루기 / 미리 풀기 / 벌금 계산 도메인 함수
- 월간 캘린더 중심 PWA Dashboard
- 모바일 주간/월간 전환
- 멤버별 월간 통계
- Study 참여원 공용 인증 규칙 설정과 규칙 변경 이력
- Chrome Extension/SWEA/CodeTree를 위한 authenticated manual ingestion endpoint

## 후속 범위
- 실제 Web Push 알림(23:00, 23:50, 03:30 등)
- SWEA/CodeTree 전용 Chrome Extension
- 기존 Notion history import
- A형 취득자 최소 난이도 판정 UI
- 여러 Study 전환 UI
