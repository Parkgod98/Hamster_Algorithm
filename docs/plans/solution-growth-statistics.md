# 풀이 성장 통계

## 목표
기존 통계 탭의 인증률/벌금 지표와 별개로, 사용자가 실제로 얼마나 풀고 어떤 난이도에 도전하고 있는지 관측할 수 있는 개인 풀이 성장 영역을 추가합니다.

## 원칙
- 기준 데이터는 `hamster_submissions`이며 자동/수동 풀이를 모두 포함합니다.
- Study Day(Asia/Seoul 04:00) 기준으로 월/주를 집계합니다.
- 플랫폼 간 난이도는 직접 비교하지 않습니다. BOJ, Programmers, SWEA는 각 플랫폼 안에서만 난이도 순서를 계산합니다.
- CodeTree `SAMSUNG`은 서열 점수로 환산하지 않고 풀이 수만 집계합니다.
- 난이도 상승을 곧바로 실력 향상으로 단정하지 않고 `난이도 추세`, `상위 난이도 비중`, `도전 수준`으로 표현합니다.
- 수동 인증은 문제 번호를 저장하지 않으므로 `고유 문제 수`가 아니라 submission 기준 `풀이 수`를 기본 KPI로 사용합니다.

## 통계 구성
- 선택한 달 총 풀이 수, 전월 대비 증감
- 활동일 수, 풀이한 날 평균 문제 수
- 플랫폼별 풀이 수
- 플랫폼별 난이도 분포
- BOJ 최고 난이도
- 플랫폼별 주간 평균 난이도 추세
- 최근 3개월 플랫폼별 평균 난이도 및 상위 난이도 비중

상위 난이도 기준은 현재 스터디 규칙의 기본 구간과 맞춰 BOJ Gold 이상, Programmers Lv.2 이상, SWEA D4 이상으로 둡니다.

## 구현
- `src/lib/growth-stats.ts`: 난이도 정규화/순서/월·주 집계 순수 함수
- `src/app/api/dashboard/route.ts`: 현재 사용자 submission을 Growth 통계 입력으로 정규화
- `src/components/dashboard.tsx`: 기존 스터디 통계 아래 개인 `풀이 성장` UI 추가
- `src/app/enhancements.css`: 성장 통계 카드/막대/추세 UI
- `tests/growth-stats.test.mjs`: 난이도 순서, Study Day 입력 기반 월 집계, 전월 비교, 플랫폼 분리 회귀 테스트

DB schema 변경은 없습니다.
