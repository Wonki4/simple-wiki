# 권한 추가 UX 수정 설계 — 아이디 지원 + 에러 표시 정상화

**작성일:** 2026-07-16
**목표:** 스페이스 권한/그룹 멤버 추가에서 (1) Keycloak 로그인 아이디로도 사용자를 찾을 수 있게 하고, (2) 예상 가능한 실패(사용자 없음 등)가 크래시 대신 화면 배너 + 서버 로그로 나타나게 한다.

## 배경 / 문제 (재현 완료)

- `addUserPermission`에 **없는 이메일**을 넣으면 `throw new Error(...)` → 서버 액션 에러는 프로덕션에서 digest로 마스킹되어 **일반 에러 화면**만 뜬다. 서버 로그에도 컴파일 번들 스택(`.next/server/app/s/[spaceKey]/settings/page.js`)만 남아 원인 파악이 어렵다. (WikiGroup PR#6 최종 리뷰의 Important #2 — 후속으로 미뤄뒀던 항목)
- 같은 throw 패턴이 4곳: `addUserPermission`(사용자 없음), `addGroupPermission`(그룹 없음), `createGroup`(중복/빈 이름), `addGroupMember`(사용자 없음).
- 사용자는 이메일로만 찾을 수 있다 — 사내에선 로그인 아이디(preferred_username)가 더 익숙하다 (사용자 결정: Keycloak username 지원).

## 1. User.username 저장

- 스키마: `User.username String? @unique` — Keycloak `preferred_username`. nullable(Postgres unique는 NULL 중복 허용) — **이 기능 배포 전 로그인한 사용자는 다음 로그인까지 null**.
- `src/auth.ts` 로그인 upsert의 update/create에 `username: p.preferred_username ?? null` 추가.
- 마이그레이션: additive `ALTER TABLE "User" ADD COLUMN "username" TEXT;` + unique index. (stray searchVector 줄 확인 규칙 유지)

## 2. 사용자 조회: 이메일 또는 아이디

- 신규 `src/lib/users.ts`: `findUserByEmailOrUsername(value)` — 이메일 정확 일치 우선, 없으면 `username` 일치(`findUnique`, unique라 모호성 없음).
- 사용처: `addUserPermission`, `addGroupMember`.
- UI 라벨/placeholder: "사용자 (이메일)" → "사용자 (이메일 또는 아이디)", `type="email"` → `type="text"` (설정 페이지 + /groups 멤버 추가 폼).

## 3. 에러 표시 정상화 (throw 제거)

예상 실패는 throw 대신 **에러 파라미터 redirect + 배너**:

- 액션: 실패 시 `redirect(현재경로 + "?error=" + encodeURIComponent(메시지))`, **성공 시에도 쿼리 없는 경로로 redirect** (이전 에러 배너가 URL에 남는 것 방지). `revalidatePath`는 redirect 전에 유지.
- 페이지: 설정 페이지와 /groups 페이지가 `searchParams`의 `error`를 읽어 기존 충돌 배너와 동일한 `.notice.notice-warn`(role="alert")으로 표시.
- 서버 로그: 실패 지점에서 `console.warn("[perm] ...")` — 운영 진단용 (마스킹된 스택 대신 원인이 찍히도록).
- 전환 대상 4곳: `addUserPermission`, `addGroupPermission`, `createGroup`, `addGroupMember`. (`removeSpacePermission`/`deleteGroup`/`removeGroupMember`는 실패 시나리오가 사실상 없어 그대로.)
- 예상 밖 에러(DB 다운 등)는 여전히 throw — 마스킹돼도 그건 진짜 장애 신호가 맞다.

에러 메시지:
- 사용자 없음: `해당 이메일 또는 아이디의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 하며, 아이디 검색은 다음 로그인부터 가능합니다.`
- 그룹 없음: `존재하지 않는 그룹입니다.` / 그룹 중복: `이미 존재하는 그룹입니다.` / 그룹 이름 없음: `그룹 이름을 입력하세요.`

## 4. 테스트

- e2e 추가 (wiki-admin 시나리오 확장 또는 신규 테스트): ① 없는 이메일 입력 → 크래시 없이 경고 배너 표시 ② `alice`(username)로 추가 → 권한 목록에 Alice 표시. (e2e 첫 테스트에서 alice가 로그인하므로 username 채워짐)
- 단위: `findUserByEmailOrUsername`은 prisma 의존이라 단위 제외(컨벤션), 기존 unit/tsc 게이트 유지.

## 범위 밖

- useActionState 기반 인라인 폼 에러(현 서버 컴포넌트 구조 유지 — redirect 방식으로 충분), 그룹 select 플레이스홀더(별도 후속), 사용자 자동완성 검색.
