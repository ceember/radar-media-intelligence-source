import { redirect } from 'next/navigation';
import { PageHeader, EmptyState } from './ui';
import { NewsjackPanel } from './newsjack-panel';
import { getCurrentUser, isAdmin, userAiEnabled } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { newsjackHistory, newsjackProfile } from '@/lib/newsjack-store';
import { researchCanWrite } from '@/lib/web-research';
import { isDemoMode } from '@/lib/session';
import type { NewsjackMode } from '@/lib/newsjack-types';
import {projectReviewRun} from '@/lib/newsjack-review-projection';

export async function NewsjackPage({mode,title,selection=''}:{mode:NewsjackMode|'setup';title:string;selection?:string}) {
  const user=await getCurrentUser();if(!user) redirect('/login');
  const project=await getCurrentProject();
  return <><PageHeader title={title} subtitle={project?`Newsjack · ${project.name} · Public Evidence And Drafts For Human Review`:'Newsjack'}/>
    {project?<NewsjackPanel key={`${project.id}:${mode}`} projectId={project.id} mode={mode} profile={await newsjackProfile(project.id)}
      canWrite={!isDemoMode()&&researchCanWrite(user,project)} canRun={!isDemoMode()&&researchCanWrite(user,project)&&userAiEnabled(user)}
      canInspect={isAdmin(user)} selection={selection} viewedAt={new Date().toISOString()} history={mode==='setup'?[]:(await newsjackHistory(project.id,mode)).map(run=>projectReviewRun(run,isAdmin(user)))} opportunities={mode==='angles'?(await newsjackHistory(project.id,'opportunities')).map(run=>projectReviewRun(run,false)):[]}/>
      :<EmptyState message="Create a project to use Newsjack."/>}</>;
}
