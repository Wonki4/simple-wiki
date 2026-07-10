# simple-wiki

마크다운 기반 조직용 위키. Keycloak 인증 + 스페이스 단위 권한 관리.

## 개발 환경 시작

```bash
docker compose up -d          # PostgreSQL + Keycloak (realm 자동 임포트)
cp .env.example .env
npm install
npm run db:migrate            # 스키마 적용
npm run db:seed               # 예시 스페이스 생성
npm run dev                   # http://localhost:3000
```

### 테스트 계정 (dev Keycloak)

| 계정 | 비밀번호 | 권한 |
|---|---|---|
| wiki-admin | admin1234 | 전역 관리자 (realm 역할 wiki-admin) |
| alice | alice1234 | /engineering 그룹 → eng 스페이스 editor |
| bob | bob1234 | 그룹 없음 |

Keycloak 관리 콘솔: http://localhost:8080 (admin/admin)

## 권한 모델

- 전역 관리자: Keycloak realm 역할 `wiki-admin` — 스페이스 생성/삭제, 모든 스페이스 관리
- 스페이스 역할: `viewer` < `editor` < `admin` — Keycloak 그룹 또는 개별 사용자에게 부여
- 공개 범위: `organization`(로그인 사용자 모두 읽기) / `restricted`(권한 부여 대상만)

## 테스트

```bash
npm test        # Vitest 단위 테스트
npm run e2e     # Playwright (docker compose + seed 필요)

# e2e 재실행 전 DB 초기화 (테스트가 생성한 데이터 제거)
docker compose down -v && docker compose up -d
npx prisma migrate deploy && npm run db:seed
```

## 운영 배포

- `Dockerfile`로 앱 이미지 빌드. `DATABASE_URL`, `AUTH_*` 환경 변수를 운영 값으로 주입
- 운영 Keycloak realm에 client 등록 후 `AUTH_KEYCLOAK_ISSUER` 교체
- 마이그레이션: `npx prisma migrate deploy`
- 첨부파일 볼륨: `ATTACHMENTS_DIR` 경로를 퍼시스턴트 볼륨으로 마운트
- 업로드 요청 크기는 앱의 Content-Length 사전 검사가 best-effort이므로, 리버스 프록시에서
  반드시 제한할 것 (예: nginx `client_max_body_size 21m`)
