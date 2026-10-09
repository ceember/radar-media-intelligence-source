import { NewsjackPage } from '@/components/newsjack-page';
export const metadata={title:'Angles And Headlines'};
export default async function Page({searchParams}:{searchParams:Promise<{run?:string;story?:string}>}) {
  const params=await searchParams;
  return <NewsjackPage mode="angles" title="Angles And Headlines" selection={`${params.run}:${params.story}`}/>;
}
