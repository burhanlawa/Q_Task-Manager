import { TaskDetail } from './_components/task-detail';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <TaskDetail taskId={id} />
    </main>
  );
}
