# 스페이스 권한 자체관리(WikiGroup) 설계

**작성일:** 2026-07-14
**목표:** 스페이스 접근 관리를 Keycloak groups 클레임 의존에서 떼어내 위키 DB 자체 그룹으로 옮긴다. 전역 관리자(wiki-admin / WIKI_ADMIN_GROUP)는 지금대로 Keycloak 기준을 유지한다.

## 배경 / 문제

스페이스 권한의 group 대상은 현재 Keycloak 그룹 경로 문자열(예: `/engineering`)이고, 판정은 로그인 시점 클레임 스냅샷(`session.groups`, `User.groups`)과의 문자열 매칭이다 (`src/lib/permissions.ts:29`).

1. **재로그인 필요** — 그룹 클레임은 로그인 시점 스냅샷이라 그룹 변경이 최대 세션 수명(8h)까지 반영되지 않는다.
2. **사내 IdP 클레임 품질** — 사내 Keycloak IdP 연계 환경에서 클레임이 소실·변형되는 문제를 이미 겪었다(관리자 판정을 WIKI_ADMIN_GROUP으로 우회한 이력). 스페이스 권한까지 클레임에 걸어두면 같은 리스크가 계속된다.
3. **보이지 않는 관리 대상** — 그룹 목록의 단일 진실이 위키 밖(Keycloak)에 있어, 스페이스 설정에서 자유 텍스트로 경로를 입력해야 하고 오타를 잡을 수 없다.

## 결정 사항 (사용자 승인)

- **A안 채택**: 위키 자체 그룹(`WikiGroup`) + 멤버십 테이블. 스페이스 권한의 group 대상이 WikiGroup을 가리킨다.
- **그룹 생성·삭제·멤버 편집은 전역 관리자 전용.** 스페이스 admin은 존재하는 그룹을 자기 스페이스에 연결(역할 부여)만 할 수 있다.
- 배제: B안(사용자 단위만 — 스페이스×인원 조합 폭발), C안(`User.groups` 직접 편집 — 단일 진실 없음, UI 만들면 A와 비용 동일).

## 데이터 모델

```prisma
model WikiGroup {
  id        String            @id @default(cuid())
  name      String            @unique
  createdAt DateTime          @default(now())
  members   WikiGroupMember[]
}

model WikiGroupMember {
  id      String    @id @default(cuid())
  groupId String
  group   WikiGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId  String
  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@index([userId])
}
```

- `SpacePermission`은 구조 유지. group 대상의 `subjectRef`가 Keycloak 경로 대신 **WikiGroup.id**를 담는다 (주석 갱신).
- `subjectRef`는 문자열 그대로(FK 없음 — user/group 겸용 컬럼). 대신 **그룹 삭제 시 같은 트랜잭션에서 `SpacePermission(subjectType=group, subjectRef=groupId)` 행을 함께 삭제**해 dangling ref를 막는다.
- `User.groups` 컬럼(클레임 스냅샷) 삭제. 관리자 판정용 클레임 읽기(`auth.ts`의 WIKI_ADMIN_GROUP)는 그대로 둔다 — 그건 로그인 시 `isWikiAdmin` 계산에만 쓰고 저장하지 않는다.

## 권한 판정 변경

`resolveSpaceRole(session, visibility, permissions)`은 순수 함수 그대로. `SessionInfo.groups`의 **의미만 바뀐다**: Keycloak 경로 목록 → 내 WikiGroup id 목록.

채워주는 곳은 행위자 결정 지점 두 곳뿐이라 여기서 DB 조회로 교체한다:

| 지점 | 현재 | 변경 |
|---|---|---|
| `getSessionInfo()` (`src/lib/access.ts:14`) | `session.groups`(클레임) | `wikiGroupMember.findMany({ where: { userId } })` → groupId 목록 |
| `resolveApiActor()` (`src/lib/api-auth.ts:47`) | `token.user.groups`(스냅샷) | 동일한 DB 조회 |

- 전역 관리자 우선 판정(`isWikiAdmin` → 무조건 admin)은 유지.
- 웹/API(PAT)/MCP가 전부 이 두 깔때기를 지나므로 다른 곳은 손댈 필요 없다. **MCP 서버는 변경 없음.**
- 요청당 인덱스 조회 1회 추가(`@@index([userId])`). 스냅샷 문제 소멸 — 그룹 변경 즉시 반영.
- `session.groups`(next-auth 세션 필드)와 `types/next-auth.d.ts`의 해당 선언은 제거.

## 그룹 관리 UI — `/groups` (전역 관리자 전용)

- 그룹 목록 + 생성(이름 unique, 공백 불가) + 삭제(ConfirmSubmitButton, "N개 스페이스에 연결됨" 경고 표시).
- 그룹 상세(또는 인라인 확장): 멤버 목록, 이메일로 멤버 추가(기존 `addSpacePermission`의 이메일→User 변환과 같은 방식 — **한 번이라도 로그인한 사용자만**), 멤버 제거.
- 서버 액션 `src/actions/groups.ts`: `createGroup` / `deleteGroup` / `addGroupMember` / `removeGroupMember`. 전부 `requireSession()` + `isWikiAdmin` 검사 (`createSpace` 패턴).
- 선등록/초대는 범위 외.

## 스페이스 설정 UI 변경

- group 대상: 자유 텍스트(`/engineering`) → **WikiGroup 드롭다운** (전체 그룹 이름 목록 — 그룹 이름은 비밀 아님).
- user 대상: 현행 유지(이메일 입력 → sub 변환, 이미 구현됨).
- `addSpacePermission`의 `"/" 시작` 검증 제거 → 존재하는 WikiGroup.id인지 검증으로 교체.
- 권한 목록 표시: group의 `subjectRef`(id) 대신 그룹 이름을 보여준다 (없어진 그룹이면 id 그대로 — 트랜잭션 정리로 사실상 발생 안 함).

## 정리되는 것들

- `auth.ts`: `User.groups` 저장 제거 (upsert에서 groups 필드 삭제). `token.groups`/`session.groups` 전파 제거. WIKI_ADMIN_GROUP 판정과 `[auth]` 진단 로그는 유지.
- Keycloak groups 매퍼는 이제 **관리자 판정(WIKI_ADMIN_GROUP)에만** 필요.
- 시드(`prisma/seed.ts`): `/engineering` 경로 → `engineering` WikiGroup 생성 + alice 멤버십 + `subjectRef=그룹id`.
- 마이그레이션: 테이블 2개 추가 + `User.groups` drop. 운영 환경은 스페이스 0개라 데이터 이행 없음, dev는 시드 재생성. (프로젝트 규칙: 생성된 SQL에서 stray `searchVector DROP DEFAULT` 줄 제거 확인.)

## 테스트

- **단위** (`tests/permissions.test.ts`): 의미 변화 반영 — groups 입력이 그룹 id 목록이어도 판정 로직 동일하므로 기존 케이스 유지 + 그룹 id 매칭 케이스 이름만 정리. 그룹 삭제 시 SpacePermission 동반 삭제 검증(액션 레벨).
- **e2e** (`e2e/wiki.spec.ts`): alice/bob 시나리오를 위키 그룹 기반으로 수정 — 관리자가 `/groups`에서 그룹 생성·alice 추가 → 스페이스에 그룹 연결 → alice 즉시 접근(재로그인 없음). bob의 restricted 404 은닉 시나리오 유지.

## 손대는 파일

- `prisma/schema.prisma` + 마이그레이션: WikiGroup, WikiGroupMember 추가, `User.groups` 제거.
- `src/lib/access.ts`, `src/lib/api-auth.ts`: 행위자 결정 시 DB 그룹 조회.
- `src/lib/permissions.ts`: 주석만(의미 변화).
- `src/auth.ts`, `src/types/next-auth.d.ts`: groups 전파 제거.
- 신규: `src/app/groups/page.tsx`(+상세), `src/actions/groups.ts`.
- `src/app/s/[spaceKey]/settings/page.tsx`, `src/actions/spaces.ts`: 그룹 드롭다운 + 검증 교체 + 이름 표시.
- `prisma/seed.ts`, `tests/permissions.test.ts`, `e2e/wiki.spec.ts`, `e2e/helpers.ts`.

## 범위 밖

- 사용자 선등록/초대 (로그인 이력 있는 사용자만 그룹에 추가 가능).
- 스페이스 admin의 그룹 생성 권한 (전역 관리자 전용으로 확정).
- Keycloak 그룹 → WikiGroup 자동 동기화.
