import { SettingsPage } from "@/components/SettingsPage";
import { SpaceVisibilityField } from "@/components/SpaceVisibilityField";
import { WikiShell } from "@/components/WikiShell";
import { redirect } from "next/navigation";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { createSpace } from "@/actions/spaces";

export default async function NewSpacePage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  const spaces = await listReadableSpaces(session);
  return (
    <WikiShell session={session} spaces={spaces}>
      <SettingsPage section="new-space" title="새 스페이스" isWikiAdmin={session.isWikiAdmin}>
        <form action={createSpace} className="settings-space-form">
          <label className="field">
            <span>키 (URL용, 소문자/숫자/하이픈)</span>
            <input name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" className="input" style={{ fontFamily: "var(--font-mono)" }} />
          </label>
          <label className="field">
            <span>이름</span>
            <input name="name" required className="input" />
          </label>
          <label className="field">
            <span>설명</span>
            <input name="description" className="input" />
          </label>
          <SpaceVisibilityField defaultValue="organization" />
          <div>
            <button className="btn btn-primary">만들기</button>
          </div>
        </form>
      </SettingsPage>
    </WikiShell>
  );
}
