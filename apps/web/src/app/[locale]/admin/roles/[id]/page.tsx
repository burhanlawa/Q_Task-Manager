import { RoleEditor } from './_components/role-editor';

export default async function RoleEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
      <RoleEditor roleId={id} />
    </main>
  );
}
