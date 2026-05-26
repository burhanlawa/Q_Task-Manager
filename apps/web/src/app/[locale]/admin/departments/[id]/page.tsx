import { DepartmentHeader } from './_components/department-header';
import { TeamsSection } from './_components/teams-section';

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
      <DepartmentHeader departmentId={id} />
      <TeamsSection departmentId={id} />
    </main>
  );
}
