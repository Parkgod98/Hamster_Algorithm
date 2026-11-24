## 변경 내용

- 

- [ ] 사용자에게 배포할 업데이트의 버전과 달라진 점을 `src/lib/release-note-content.json`에 적었다.

## 검증

- [ ] `npm run validate`
- [ ] `npm run validate:git`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] 필요 시 `npm test`

## 데이터 / 보안 확인

- [ ] Secret, token, 실제 개인정보를 커밋하지 않았다.
- [ ] DB 변경은 새 migration으로 추가했다.
- [ ] webhook 처리에서 delivery/source event 멱등성을 유지했다.
- [ ] service role/private key는 서버 경계를 벗어나지 않는다.

## 참고

- 
