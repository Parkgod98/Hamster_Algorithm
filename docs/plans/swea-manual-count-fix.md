# SWEA 자동 인증과 수동 수량 입력 수정

## 목표
- BaekjoonHub가 `SWEA/D5/3308...` 형태로 push한 풀이를 자동 인증합니다.
- 수동 인증의 문제 수 입력에서 기본값 1에 숫자가 덧붙는 UX를 제거합니다.
- 기존 Rule Engine과 Study Day 판정은 그대로 재사용합니다.

## 구현
- `parseBaekjoonHubCommit`에 `SWEA/D{난이도}/{문제번호}...` 경로 파서를 추가합니다.
- 같은 commit에서 README와 소스 파일이 함께 추가되어도 문제 하나만 생성하도록 기존 `seen` 중복 제거를 유지합니다.
- SWEA 난이도는 `D2`, `D3`, `D4`, `D5`, `D6` 등 경로 값을 그대로 정규화합니다.
- 수동 인증 문제 수는 자유 입력 대신 1~20 선택 UI로 바꿔 `1 → 12` 입력 문제를 제거합니다.
- 파서 테스트에 실제 BaekjoonHub SWEA 경로 형식을 추가합니다.

## 검증
- Repository Harness 전체 실행
- `npm test`에서 SWEA 파싱, 중복 제거, 기존 BOJ/Programmers 회귀 확인
- 신규 migration 없음
