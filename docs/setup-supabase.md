# Supabase Setup

1. 새 Supabase project를 만듭니다.
2. GitHub OAuth provider를 활성화합니다.
3. `supabase/migrations/` migration을 적용합니다.
4. Vercel/로컬 환경변수에 URL/anon key/service role key를 등록합니다.

필수 환경변수:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저에 노출하지 않습니다.
