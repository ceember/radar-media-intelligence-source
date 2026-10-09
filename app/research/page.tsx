import { redirect } from 'next/navigation';
import { PageHeader, EmptyState } from '@/components/ui';
import { ResearchPanel } from '@/components/research-panel';
import { getCurrentUser, userAiEnabled } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { researchHistory } from '@/lib/research-store';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite } from '@/lib/web-research';

export const metadata = { title: 'Web Research' };

export default async function ResearchPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const project = await getCurrentProject();
  return <>
    <PageHeader title="Web Research" subtitle={project ? `Research public web sources and save cited answers in “${project.name}”.` : 'Research public web sources.'} />
    {project ? <ResearchPanel key={project.id} projectId={project.id} history={await researchHistory(project.id)}
      enabled={!isDemoMode() && userAiEnabled(user) && researchCanWrite(user, project)}
      disabledReason={researchCanWrite(user, project) ? undefined : 'This shared project is read-only. Only its owner or an admin can run research.'} /> : <EmptyState message="Create a project to save research." />}
  </>;
}
