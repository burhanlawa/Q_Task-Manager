import { ProfileView } from './_components/profile-view';
import { RolesSection } from './_components/roles-section';

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <ProfileView userId={id} />
      <RolesSection userId={id} />
    </main>
  );
}
