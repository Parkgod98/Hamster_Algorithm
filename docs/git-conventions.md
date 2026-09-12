# Git Conventions

## 브랜치
형식: `<type>/<english-kebab-case>`

허용 type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`

- 일반 작업은 최신 `main`에서 시작합니다.
- 한 브랜치는 하나의 목적만 가집니다.
- `main` 직접 커밋은 금지합니다. 저장소 최초 bootstrap만 예외입니다.

## 커밋
형식: `<type>: <한글로 구체적인 설명>`

예: `feat: GitHub webhook 풀이 수집 추가`

- 한 커밋에는 하나의 논리적 목적을 담습니다.
- `수정`, `작업`, `update`만으로 끝나는 모호한 설명을 쓰지 않습니다.

## Pull Request
제목은 `<type>: <한글 설명>`이며 브랜치 type과 같아야 합니다.
본문에는 `## 변경 내용`, `## 검증`, `## 데이터 / 보안 확인`, `## 참고`가 모두 있어야 합니다.

## Merge
기본은 Squash merge입니다. Merge는 사용자가 직접 확인한 뒤 수행하는 흐름을 권장합니다.

## Repository Ruleset 권장
`main`에 대해 다음을 켭니다.
- Require a pull request before merging
- Require status checks to pass before merging
- Block force pushes
- Restrict deletions

필수 status check는 `Validate repository, Git policy, Supabase isolation, PWA, lint, typecheck and build` Job을 지정합니다.
