import type { SpaceVisibility } from "./permissions";

export const spaceVisibilityInfo = {
  organization: {
    label: "전체 공개",
    description: "위키에 로그인한 모든 사용자가 문서를 읽을 수 있습니다.",
    icon: "people",
  },
  restricted: {
    label: "비공개",
    description: "권한을 받은 사용자와 그룹 구성원, 위키 관리자만 문서를 읽을 수 있습니다.",
    icon: "lock",
  },
} as const satisfies Record<SpaceVisibility, { label: string; description: string; icon: string }>;
