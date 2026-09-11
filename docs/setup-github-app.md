# GitHub App Setup

GitHub App 등록은 Repository 코드만으로 자동 생성할 수 없으므로 최초 1회 GitHub UI에서 설정합니다.

## 권장 권한
Repository permissions:
- Contents: Read-only
- Metadata: Read-only

Subscribe to events:
- Push

Webhook URL:
`https://<production-domain>/api/github/webhook`

Webhook secret은 `GITHUB_WEBHOOK_SECRET`과 동일하게 설정합니다.

Setup URL은 서비스 Dashboard 또는 설치 완료 안내 URL로 설정합니다.

## 환경변수
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

Private key PEM의 줄바꿈은 배포 환경에서 `\n`으로 저장해도 서버가 복원합니다.

## Repository 연결 정책
사용자는 GitHub App 설치 시 `Only select repositories`를 사용해 알고리즘 Repository만 허용하는 것을 권장합니다. 서비스는 GitHub repository numeric id를 기준으로 연결을 식별하며 Repository 이름 변경에 의존하지 않습니다.
