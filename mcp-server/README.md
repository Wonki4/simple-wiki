# simple-wiki MCP 서버

simple-wiki를 MCP(Model Context Protocol) 도구로 노출합니다. Claude Desktop, Claude Code 등
MCP 클라이언트에서 위키 문서를 읽고 쓸 수 있습니다.

두 가지 전송 방식을 지원합니다:

- **stdio** (`dist/index.js`) — 클라이언트가 로컬에서 서버를 실행. 1인 = 1토큰.
- **streamable-http** (`dist/http.js`) — 한 번 띄워두고 여러 사용자가 원격 접속. 각자 자신의 토큰을 헤더로 전달.

## 제공 도구

| 도구 | 설명 | 권한 |
|---|---|---|
| `list_spaces` | 읽을 수 있는 스페이스 목록 | viewer |
| `list_pages` | 스페이스의 페이지 목록 | viewer |
| `search_pages` | 제목·본문 전문 검색 | viewer |
| `get_page` | 페이지 마크다운 원문 | viewer |
| `create_page` | 새 페이지 생성 | editor |
| `update_page` | 페이지 수정(새 리비전) | editor |
| `delete_page` | 페이지 삭제 | editor |

권한은 토큰을 발급한 사용자의 스페이스 권한을 그대로 따릅니다. 읽을 수 없는 스페이스는
목록·조회 모두 404로 숨겨집니다.

### 서버 사용 지침(instructions)

서버는 MCP `instructions`로 "권장 흐름(검색 → 읽기 → 쓰기, slug 사용법, 409 시 update 전환,
삭제 주의)"을 담아 호스트에 전달합니다. 대부분의 호스트가 이를 모델 컨텍스트에 자동 주입하므로,
LLM이 도구를 올바른 순서로 조합해 쓰도록 유도됩니다. 별도 프롬프트 없이도 동작하지만, 호스트
쪽 시스템 프롬프트에 "사내 지식은 simple-wiki MCP에서 찾아라, 스페이스 키는 notice/eng/…"를
덧붙이면 더 적극적으로 활용합니다.

## 토큰(PAT) 발급

위키에 로그인 → 헤더의 **토큰** → `/settings/tokens` 에서 개인 액세스 토큰 발급 (`swk_...`).
LLM/에이전트마다 **별도 토큰**을 쓰세요(감사·폐기가 쉽고, 접근 범위를 토큰 소유자 권한으로 제한).

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WIKI_BASE_URL` | `http://localhost:3000` | 위키 주소 |
| `WIKI_API_TOKEN` | — | stdio에선 필수. http에선 헤더 없는 요청의 폴백 토큰(선택) |
| `PORT` | `3333` | (http) 수신 포트 |
| `HOST` | `127.0.0.1` | (http) 바인드 호스트. 공개 노출 시에만 `0.0.0.0` 지정 |
| `MCP_PATH` | `/mcp` | (http) 엔드포인트 경로 |
| `MCP_ALLOW_ORIGIN` | (없음) | (http) CORS 허용 오리진. 미설정 시 CORS 헤더 없음. 브라우저 클라이언트용으로만 특정 오리진 지정 |
| `MCP_ALLOWED_HOSTS` | (없음) | (http) 쉼표구분 허용 Host. 지정 시 DNS 리바인딩 보호 활성화 |

## 빌드 / 실행

```bash
cd mcp-server
npm install          # postinstall(prepare)로 자동 빌드됨
npm run build        # 수동 빌드 (tsc → dist/)
npm start            # stdio 모드
npm run start:http   # streamable-http 모드 (원격)
```

## npx로 쓰기

`bin`이 정의돼 있어 설치 없이 실행할 수 있습니다.

```bash
# 로컬 클론에서
npx . 
# 또는 (레지스트리 배포 후)
npx simple-wiki-mcp          # stdio
npx simple-wiki-mcp-http     # http
```

> 레지스트리 배포: 이 패키지는 실수 방지를 위해 `private: true`입니다. 배포하려면 `private`을
> 제거하고(원하면 `@조직/simple-wiki-mcp`로 스코프 지정) `npm publish` 하세요. `files`·`prepublishOnly`
> 는 이미 설정돼 있어 `dist`만 빌드되어 배포됩니다.

## 클라이언트 등록

### Claude Desktop (로컬 stdio)

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "simple-wiki": {
      "command": "node",
      "args": ["/절대경로/simple-wiki/mcp-server/dist/index.js"],
      "env": {
        "WIKI_BASE_URL": "http://localhost:3000",
        "WIKI_API_TOKEN": "swk_..."
      }
    }
  }
}
```

### Claude Code (로컬 stdio)

```bash
claude mcp add simple-wiki \
  --env WIKI_BASE_URL=http://localhost:3000 \
  --env WIKI_API_TOKEN=swk_... \
  -- node /절대경로/simple-wiki/mcp-server/dist/index.js
```

### 원격 streamable-http (조직 배포)

서버를 한 번 띄우고(예: 위키 옆에 배포). 공개 노출이므로 `HOST=0.0.0.0`을 명시하고
반드시 HTTPS 프록시 뒤에 둡니다:

```bash
HOST=0.0.0.0 PORT=3333 WIKI_BASE_URL=https://wiki.내회사.com npm run start:http
# 리버스 프록시가 특정 호스트명으로만 들어온다면 DNS 리바인딩 보호도 켤 수 있습니다:
#   MCP_ALLOWED_HOSTS=mcp.내회사.com HOST=0.0.0.0 ... npm run start:http
```

각 사용자는 **자신의 토큰**을 헤더로 붙여 접속합니다(1인 1토큰 → 각자 권한 그대로):

```bash
claude mcp add --transport http simple-wiki \
  https://mcp.내회사.com/mcp \
  --header "Authorization: Bearer swk_사용자토큰"
```

동작 방식: 서버는 세션 없는(stateless) 모드로, 요청마다 `Authorization: Bearer <PAT>`를 읽어
그 토큰으로 위키 API를 호출합니다. 토큰 없는 요청은 401.

**운영 주의**
- 반드시 **TLS/리버스 프록시(HTTPS)** 뒤에 두세요. 토큰이 평문으로 오갑니다.
- 공개망 노출 시 `MCP_ALLOW_ORIGIN`을 실제 오리진으로 제한하는 걸 권장합니다.
- 헬스체크: `GET /health` → `{ ok: true, ... }`.

## 동작 확인 (스모크 테스트)

위키(`http://localhost:3000`)가 떠 있는 상태에서:

```bash
WIKI_API_TOKEN=swk_... node smoke-test.mjs
```

6개 도구를 순서대로 호출하고(목록·읽기·생성·수정·삭제), 없는 페이지 404 / 권한 부족 403이
`isError`로 전달되는지 확인합니다.

## 구조

`src/tools.ts`가 도구 정의와 `instructions`를 담은 서버 팩토리(`createWikiMcpServer(token, baseUrl)`)를
제공하고, `src/index.ts`(stdio)와 `src/http.ts`(http)가 이를 공유합니다. 도구를 한 곳에서만 관리하면
두 전송 방식이 항상 동일하게 동작합니다.
