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
| `search_pages` | 제목·본문 검색. 선택 인자 `space`와 `page`(1부터)로 범위와 결과 페이지 지정. 페이지당 50건, 전체 건수·페이지 수 반환 | viewer |
| `get_page` | 페이지 마크다운 원문 | viewer |
| `create_page` | 새 페이지 생성 | editor |
| `update_page` | 페이지 수정(새 리비전) | editor |
| `save_page_html` | 에이전트가 작성한 HTML을 문서에 저장하고 HTML Viewer 링크를 반환 | editor |
| `list_wiki_topics` | 스페이스에서 관련 주제를 찾고 제목, 고정 키, 버전 조회 | viewer |
| `get_wiki_topic` | 주제의 항목과 각 항목의 근거 문장, 원문 버전 조회 | viewer |
| `save_page_wiki_topics` | 저장한 문서 버전을 근거로 관련 주제의 항목 갱신 | editor |
| `save_page_timeline` | 원문 버전의 회의·논의와 결정을 근거 문장과 함께 저장 | editor |
| `list_timeline_sources` | 기간 내에 저장한 버전 중 변경 이력의 논의·결정을 아직 정리하지 않은 버전 조회 | viewer |
| `delete_page` | 문서를 휴지통으로 이동 | editor |
| `list_trashed_pages` | 스페이스 휴지통 목록 | editor |
| `restore_trashed_page` | 휴지통 문서를 ID로 복원 | editor |

권한은 발급자의 현재 권한과 토큰의 발급 범위를 함께 적용합니다. 범위 밖 스페이스는 목록과 검색에서 제외되며 직접 조회하면 404가 반환됩니다.

### 문서와 LLM Wiki 주제를 함께 저장하기

예를 들어 `배포와 롤백` 주제의 오류율 기준이 바뀌면, 회의록을 쓰는 에이전트가 기존 주제에서 그 기준을 찾아 갱신합니다.

1. 기존 문서를 수정할 때는 `list_wiki_topics`의 `sourceSlug`로 이 문서를 인용 중인 주제를 확인합니다. 새로 관련된 주제는 `query`로 찾아보고, `get_wiki_topic(space, key)`에서 현재 버전과 항목 키를 읽습니다.
2. `create_page`, `update_page`, `append_to_page`, `replace_in_page`, `revert_page`에 `wikiTopics`를 함께 전달합니다. 아래 예시에서는 기존 주제의 버전이 3이고, 회의록에 변경 결정이 명시되어 있습니다.
3. 저장 응답의 `llmWiki.status`를 확인합니다. `complete`면 주제 처리가 끝났습니다. `get_wiki_topic`으로 근거를 조회하고 `get_page(space, slug, version)`으로 그 당시의 원문을 읽을 수 있습니다.

```json
{
  "space": "eng",
  "title": "6월 운영 회의록",
  "content": "배포 후 오류율이 1%를 넘으면 롤백하기로 확정했다.",
  "wikiTopics": [{
    "key": "배포-롤백", "title": "배포와 롤백", "expectedVersion": 3,
    "changes": [{
      "key": "오류율-기준", "kind": "current", "text": "배포 후 오류율이 1%를 넘으면 롤백한다.",
      "evidence": "배포 후 오류율이 1%를 넘으면 롤백하기로 확정했다."
    }]
  }]
}
```

`expectedVersion`은 **주제** 버전입니다. 처음 만드는 주제에는 0을 씁니다. 적용 사례는 `example`, 제안은 `discussion`, 확정된 기준은 `current`로 기록합니다. 항목을 고칠 때는 기존 키를 재사용하고 `changes`에 수정할 항목만 담습니다. 지식 변화가 없는 원문은 `wikiTopics: []`로 저장합니다.

`wikiTopics`를 생략했거나 주제 갱신이 실패하면 마크다운 저장은 완료된 채 `llmWiki.status`가 `pending`으로 돌아옵니다. 응답의 `source`에 있는 `space`, `slug`, `pageId`, **원문** `version`을 복사하고 `topics`를 더해 `save_page_wiki_topics`를 호출합니다. 409 응답이면 최신 원문과 주제를 읽어 적용할 변경을 다시 판단하세요. `pageId`가 바뀌면 같은 주소에 새 문서가 생겼으므로 근거도 새로 확인합니다. 같은 원문 버전에 동일한 요청을 다시 보내도 중복되지 않습니다.

모든 근거 문서가 휴지통에 있으면 그 주제는 목록과 조회에서 숨겨집니다. 새 원문으로 같은 키를 다시 사용할 때 생성이 409이고 상세 조회가 404라면, 충돌 응답의 `currentVersion`을 `expectedVersion`에 넣어 새 근거의 항목을 저장할 수 있습니다.

### 회의록을 스페이스 변경 이력에 기록하기

문서를 작성하거나 수정한 에이전트는 같은 작업에서 `save_page_timeline`에 저장 응답의 `version`을 전달합니다. 제안은 `discussion`, 원문에 채택 또는 번복이 명시된 사항은 `decision`으로 보냅니다.

```json
{
  "space": "eng", "slug": "운영-회의록", "version": 3,
  "entries": [{
    "kind": "decision",
    "summary": "배포 후 오류율 2%를 롤백 기준으로 채택",
    "evidence": "배포 후 오류율이 2%를 넘으면 롤백하기로 했다.",
    "date": "2026-05-08"
  }]
}
```

`evidence`는 지정한 버전의 마크다운 본문에서 그대로 가져옵니다. 회의 날짜가 제목이나 본문에 있을 때만 `date`를 지정하고, 생략하면 버전의 저장일이 적용됩니다. 같은 버전을 다시 처리할 때는 그 버전에 남길 항목 전체를 보내세요. 오탈자 수정 등 기록할 사항이 없으면 `entries: []`로 처리를 마칩니다.

과거 회의록은 스페이스의 **변경 이력**에서 **기간 정리 요청 복사**로 시작할 수 있습니다. `list_timeline_sources(space, from, to)`로 한국 날짜 기준 양 끝 날짜를 포함한 목록을 받고, 각 항목을 `get_page(space, slug, version)`로 읽어 저장합니다. `nextCursor`가 있으면 같은 기간과 커서로 이어서 조회합니다.

### HTML Viewer에 문서 표시하기

문서를 열고 **HTML Viewer**를 선택하세요. 아직 HTML이 없으면 에이전트에게 보낼 요청 예시가 표시됩니다. 위키 MCP에 연결된 에이전트에게 문서 링크와 함께 “이 문서를 HTML로 만들어 위키에 저장해 줘”라고 요청하면 됩니다. 에이전트에는 해당 스페이스의 편집 권한과 쓰기 가능한 토큰이 필요합니다.

1. `get_page(space, slug)`로 최신 마크다운 원문과 `version`을 읽습니다.
2. 에이전트가 원문에 맞춰 HTML과 CSS를 작성합니다. 표, CSS 그래프, `<details>` 등을 사용할 수 있습니다. HTML Viewer는 스크립트와 외부 리소스 요청을 차단합니다.
3. `save_page_html`을 호출합니다. `html`은 UTF-8 기준 최대 512 KiB이고 `baseVersion`은 1단계에서 읽은 버전입니다.

```json
{
  "space": "eng",
  "slug": "검색-성능",
  "baseVersion": 3,
  "html": "<style>h1 { color: #125845 }</style><h1>검색 성능</h1><p>동시 요청 30개에서 p95는 64.6ms였습니다.</p>"
}
```

성공하면 `baseVersion`과 HTML Viewer의 절대 주소인 `previewUrl`을 반환합니다. 사용자가 링크를 열면 위키에서 해당 스페이스의 읽기 권한을 확인합니다. 같은 문서에 다시 저장하면 이전 HTML을 교체합니다. 마크다운 내용과 버전은 그대로 유지됩니다.

원문이 먼저 바뀌면 HTTP 409와 현재 버전을 반환합니다. `get_page`로 다시 읽고 변경 사항을 디자인에 반영한 뒤 재시도하세요.

### 서버 사용 지침(instructions)

서버는 MCP `instructions`로 "권장 흐름(검색 → 읽기 → 쓰기, slug 사용법, 409 시 update 전환,
삭제 주의)"을 담아 호스트에 전달합니다. 대부분의 호스트가 이를 모델 컨텍스트에 자동 주입하므로,
LLM이 도구를 올바른 순서로 조합해 쓰도록 유도됩니다. 별도 프롬프트 없이도 동작하지만, 호스트
쪽 시스템 프롬프트에 "사내 지식은 simple-wiki MCP에서 찾아라, 스페이스 키는 notice/eng/…"를
덧붙이면 더 적극적으로 활용합니다.

## 토큰(PAT) 발급

위키에 로그인 → 헤더의 **토큰** → `/settings/tokens` 에서 개인 액세스 토큰 발급 (`swk_...`).
검색용 LLM에는 **읽기 전용**, 특정 팀 위키를 편집하는 LLM에는 **읽기·쓰기**와 해당 스페이스를 선택할 수 있습니다. 전체 검색과 첨부 조회에도 같은 범위가 적용됩니다. 지정한 스페이스를 삭제하면 그 스페이스 전용 토큰도 폐기됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WIKI_BASE_URL` | `http://localhost:3000` | 위키 주소 |
| `WIKI_PUBLIC_URL` | `WIKI_BASE_URL` | 사용자가 브라우저로 위키에 접속하는 주소. MCP가 내부 서비스 주소로 API를 호출할 때 지정하면 HTML Viewer 링크에 이 주소를 사용합니다. |
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

각 사용자는 **자신의 토큰**을 헤더로 붙여 접속합니다(1인 1토큰 → 각 토큰의 발급 범위 적용):

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

스모크 스크립트는 위키 도구를 실제 호출합니다. 별도로 `npm test`는 로컬 위키나 토큰 없이 빌드 후 MCP가 반환하는 HTML Viewer 링크, 버전 충돌·권한 오류 전달, HTML 크기 제한을 검증합니다.

## 구조

`src/tools.ts`가 도구 정의와 `instructions`를 담은 서버 팩토리(`createWikiMcpServer(token, baseUrl, publicUrl?)`)를
제공하고, `src/index.ts`(stdio)와 `src/http.ts`(http)가 이를 공유합니다. 도구를 한 곳에서만 관리하면
두 전송 방식이 항상 동일하게 동작합니다.
