import {redirect} from 'next/navigation';
import {PageHeader,EmptyState} from './ui';
import {NewsjackVisibilityPanel} from './newsjack-visibility-panel';
import {getCurrentUser,userAiEnabled,isAdmin} from '@/lib/auth';
import {getCurrentProject} from '@/lib/data';
import {researchCanWrite} from '@/lib/web-research';
import {isDemoMode} from '@/lib/session';
import {visibilityHistory} from '@/lib/newsjack-visibility-store';
import {visibilityRunForViewer} from '@/lib/newsjack-visibility-diagnostics';

export async function NewsjackVisibilityPage(){
 const user=await getCurrentUser();if(!user)redirect('/login');
 const project=await getCurrentProject(),canWrite=!!project&&!isDemoMode()&&researchCanWrite(user,project);
 return <><PageHeader title="AI Visibility" subtitle={project?`Newsjack · ${project.name} · Supplied-Copy Writing Audit`:'Newsjack'}/>{project?<NewsjackVisibilityPanel key={project.id} projectId={project.id} canWrite={canWrite} canRun={canWrite&&userAiEnabled(user)} administrator={isAdmin(user)} history={(await visibilityHistory(project.id)).map(run=>visibilityRunForViewer(run,isAdmin(user)))}/>:<EmptyState message="Create a project to use AI Visibility."/>}</>;
}
