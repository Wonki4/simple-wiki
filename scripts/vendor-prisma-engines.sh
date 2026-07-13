#!/usr/bin/env bash
# Prisma 엔진 바이너리를 인터넷에 연결된 머신에서 받아 prisma/engines/ 에 vendored 한다.
#
# 왜 필요한가:
#   폐쇄망(에어갭)에서는 `prisma generate` / `prisma migrate` 가 엔진 바이너리를
#   binaries.prisma.sh(CDN)에서 받으려다 실패한다. 사내 미러도 없으므로, 연결된
#   머신에서 이 스크립트로 엔진을 미리 받아 소스와 함께 반입한다.
#
# 사용법:
#   1) (연결된 곳) npm install          # @prisma/engines-version 이 있어야 함
#   2) (연결된 곳) ./scripts/vendor-prisma-engines.sh [PLATFORM]
#   3) 생성된 prisma/engines/ 를 소스와 함께 폐쇄망으로 반입
#
# PLATFORM 기본값은 linux-musl-openssl-3.0.x (런타임 베이스 이미지가 node:*-alpine).
# Prisma 버전을 올리면 엔진 커밋 해시가 바뀌므로 이 스크립트를 다시 실행한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLATFORM="${1:-linux-musl-openssl-3.0.x}"
OUT="prisma/engines"

# 설치된 Prisma 버전에 정확히 대응하는 엔진 커밋 해시를 동적으로 읽는다.
COMMIT="$(node -e "process.stdout.write(require('@prisma/engines-version').enginesVersion)" 2>/dev/null || true)"
if [ -z "$COMMIT" ]; then
  echo "오류: 엔진 커밋 해시를 읽지 못했습니다. 먼저 (연결된 곳에서) 'npm install' 하세요." >&2
  exit 1
fi

BASE="https://binaries.prisma.sh/all_commits/${COMMIT}/${PLATFORM}"
mkdir -p "$OUT"

echo "Prisma 엔진 vendoring"
echo "  commit:   $COMMIT"
echo "  platform: $PLATFORM"
echo "  대상:     $OUT/"

fetch() {
  # $1: CDN 상의 원본 파일명, $2: 로컬에 저장할 이름
  local remote="$1" local_name="$2"
  echo "  - 다운로드: $local_name"
  curl -fSL --retry 3 "${BASE}/${remote}.gz" -o "${OUT}/${local_name}.gz"
  gunzip -f "${OUT}/${local_name}.gz"
}

# Prisma 6 기본은 library 엔진.
# libquery_engine: 런타임 쿼리 + prisma generate 가 사용.
# schema-engine:   prisma migrate deploy 가 사용.
fetch "libquery_engine.so.node" "libquery_engine-${PLATFORM}.so.node"
fetch "schema-engine"           "schema-engine-${PLATFORM}"
chmod +x "${OUT}/schema-engine-${PLATFORM}"

echo ""
echo "완료. 아래 파일을 소스와 함께 폐쇄망으로 반입하세요:"
ls -la "$OUT"
