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

Setup URL은 `https://<production-domain>/github/setup`으로 설정합니다. 앱은 스터디 설정에서 연결을 시작한 브라우저로 돌아와 설치와 계정 소유자를 확인합니다. Supabase의 GitHub OAuth provider를 활성화하고 햄쮸터의 `https://<production-domain>/auth/callback`을 허용된 redirect URL에 등록합니다. Preview에서 새 설치까지 검증하려면 해당 호스트로 돌아오는 별도의 테스트 GitHub App과 허용된 callback을 사용합니다.

## 환경변수
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

Private key PEM의 줄바꿈은 배포 환경에서 `\n`으로 저장해도 서버가 복원합니다.

## Repository 연결 정책
사용자는 GitHub App 설치 시 `Only select repositories`를 사용해 알고리즘 Repository만 허용하는 것을 권장합니다. 서비스는 GitHub repository numeric id를 기준으로 연결을 식별하며 Repository 이름 변경에 의존하지 않습니다.

햄쮸터 로그인과 GitHub 연동은 독립적입니다. GitHub 계정 확인은 본인 소유의 설치나 소유자 권한이 있는 조직의 설치를 연결할 때 사용합니다. 인증 토큰은 연결을 마치면 폐기합니다. 풀이 수집 중 실패한 delivery는 서명된 재전송이나 매일 한국시간 08:10의 재처리 작업으로 이어집니다. 재처리 작업에는 기존 `CRON_SECRET`을 사용합니다.
