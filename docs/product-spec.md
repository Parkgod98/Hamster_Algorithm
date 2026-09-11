# Product Spec

## 문제
현재 스터디원은 BaekjoonHub가 GitHub에 자동 커밋한 결과를 다시 캡처하고 Notion에 올려 인증합니다. 실제 풀이 기록은 이미 GitHub에 있는데 사람이 같은 사실을 다시 옮기고 있습니다.

Hamster Algorithm은 각자의 Repository에서 발생한 풀이 이벤트를 자동 수집해 스터디 규칙으로 판정하고, 인증/미루기/미리 풀기/벌금/통계를 한 화면에서 관리하는 PWA를 목표로 합니다.

## 사용자 흐름
1. GitHub OAuth로 로그인합니다.
2. 햄쮸터 Study를 만들거나 초대받아 참여합니다.
3. GitHub App을 설치하고 자신의 알고리즘 Repository만 선택합니다.
4. 이후 문제를 평소처럼 풀고 BaekjoonHub가 push하면 자동 인증됩니다.
5. Dashboard에서 스터디원별 오늘 상태와 자신의 풀이 내역을 확인합니다.
6. 못 푸는 날은 23:59 전에 미루기를 신청합니다.

## 원문 규칙 반영
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

## 제품 해석이 필요한 부분
원문에는 서로 다른 난이도/플랫폼 문제를 같은 날 섞어 풀었을 때의 합산 규칙이 없습니다. MVP에서는 문제별 필요량의 역수를 credit으로 계산해 합이 1 이상이면 완료로 판정합니다. 예: Silver 1문제(0.5) + Bronze 2문제(0.666...)도 완료입니다. 실제 스터디 의도와 다르면 RuleSet 설정으로 바꿀 수 있게 유지합니다.

A형 취득자의 BOJ 최소 난이도 Silver 3 규칙은 멤버별 자격 속성이 필요하므로 `study_members.boj_minimum_difficulty`로 모델링할 수 있도록 schema에 필드를 둡니다.

## MVP 범위
- GitHub OAuth 로그인 구조
- Study / Member / Repository 연결 schema
- GitHub App 설치와 push webhook 수집
- BaekjoonHub BOJ / Programmers 자동 파싱
- Study Day(04:00) 판정
- credit 기반 하루 완료 판정
- 미루기 / 미리 풀기 / 벌금 계산을 위한 도메인 함수
- 모바일 우선 PWA Dashboard
- Chrome Extension/SWEA/CodeTree를 위한 authenticated manual ingestion endpoint

## 후속 범위
- Study 초대 링크 UI
- 실제 Web Push 알림(23:00, 23:50, 03:30 등)
- SWEA/CodeTree 전용 Chrome Extension
- 과거 GitHub commit backfill UI
- 기존 Notion history import
- 통계/잔디/연속 인증일
