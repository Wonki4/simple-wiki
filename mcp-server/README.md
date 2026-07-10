# simple-wiki MCP 서버

simple-wiki를 MCP(Model Context Protocol) 도구로 노출합니다. Claude Desktop, Claude Code 등
MCP 클라이언트에서 위키 문서를 읽고 쓸 수 있습니다.

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

## 준비

1. 위키에 로그인 → 헤더의 **토큰** → `/settings/tokens` 에서 개인 액세스 토큰 발급 (`swk_...`)
2. 빌드:

```bash
cd mcp-server
npm install
npm run build
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WIKI_API_TOKEN` | (필수) | 발급받은 개인 액세스 토큰 |
| `WIKI_BASE_URL` | `http://localhost:3000` | 위키 주소 |

## Claude Desktop 등록

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

## Claude Code 등록

```bash
claude mcp add simple-wiki \
  --env WIKI_BASE_URL=http://localhost:3000 \
  --env WIKI_API_TOKEN=swk_... \
  -- node /절대경로/simple-wiki/mcp-server/dist/index.js
```

## 동작 확인 (스모크 테스트)

위키(`http://localhost:3000`)가 떠 있는 상태에서:

```bash
WIKI_API_TOKEN=swk_... node smoke-test.mjs
```

6개 도구를 순서대로 호출하고(목록·읽기·생성·수정·삭제), 없는 페이지 404 / 권한 부족 403이
`isError`로 전달되는지 확인합니다.
