import {redirect} from 'next/navigation';
import {PageHeader,EmptyState} from './ui';
import {NewsjackPlanningPanel} from './newsjack-planning-panel';
import {getCurrentUser,userAiEnabled,isAdmin} from '@/lib/auth';
import {getCurrentProject} from '@/lib/data';
import {researchCanWrite} from '@/lib/web-research';
import {isDemoMode} from '@/lib/session';
import {planningHistory,coverageConfig} from '@/lib/newsjack-planning-store';
import {PLANNING_TITLES,type PlanningMode} from '@/lib/newsjack-planning-types';
import {planningRunForViewer} from '@/lib/newsjack-planning-visibility';
export async function NewsjackPlanningPage({mode}:{mode:PlanningMode}){
 const user=await getCurrentUser();if(!user)redirect('/login');const project=await getCurrentProject(),canWrite=!!project&&!isDemoMode()&&researchCanWrite(user,project);
 return <><PageHeader title={PLANNING_TITLES[mode]} subtitle={project?`Newsjack · ${project.name} · Public Evidence And Drafts For Human Review`:'Newsjack'}/>{project?<NewsjackPlanningPanel key={`${project.id}:${mode}`} mode={mode} projectId={project.id} projectName={project.name} canWrite={canWrite} canRun={canWrite&&userAiEnabled(user)} canInspect={isAdmin(user)} history={(await planningHistory(project.id,mode)).map(run=>planningRunForViewer(run,isAdmin(user))!)} config={mode==='coverage'?await coverageConfig(project.id):null} viewedAt={new Date().toISOString()}/>:<EmptyState message="Create a project to use Newsjack."/>}</>;
}
