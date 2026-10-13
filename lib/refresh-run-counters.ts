import {z} from 'zod';

const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const refreshCounterSchema=z.strictObject({connector:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),fetched:count,filtered:count,duplicate:count,inserted:count,quota_skipped:count,error:count,elapsed_ms:count});
export const refreshCountersSchema=z.array(refreshCounterSchema).max(64);
export type RefreshCounter=z.infer<typeof refreshCounterSchema>;
export type RefreshCounters=Map<string,RefreshCounter>;

export function refreshCounter(counters:RefreshCounters,connector:string):RefreshCounter{
 let entry=counters.get(connector);
 if(!entry){entry=refreshCounterSchema.parse({connector,fetched:0,filtered:0,duplicate:0,inserted:0,quota_skipped:0,error:0,elapsed_ms:0});counters.set(connector,entry);}
 return entry;
}

export function refreshCounterSnapshot(counters:RefreshCounters):RefreshCounter[]{
 return refreshCountersSchema.parse([...counters.values()].sort((left,right)=>left.connector.localeCompare(right.connector)));
}
