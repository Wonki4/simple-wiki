import { requireSpaceRole, listReadableSpaces } from "@/lib/access";
import { WikiShell } from "@/components/WikiShell";

export default async function SpaceLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ spaceKey: string }>;
}) {
  const { spaceKey } = await params;
  const { session, space } = await requireSpaceRole(spaceKey, "viewer");
  const spaces = await listReadableSpaces(session);
  return <WikiShell session={session} spaces={spaces} current={space}>{children}</WikiShell>;
}
