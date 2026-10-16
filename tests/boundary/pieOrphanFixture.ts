import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

/** A real child exits without releasing its private directory. No provider is simulated. */
export async function orphanFixture(
  root: string,
  phase: "prepared" | "creating" = "creating",
  docker?: { image: string; executable: string },
) {
  const script = join(root, "child.mjs");
  const url = pathToFileURL(
    resolve("dist/pie/execution/resourceJournal.js"),
  ).href;
  const moduleUrl = (name: string) =>
    pathToFileURL(resolve(`dist/pie/execution/${name}.js`)).href;
  await writeFile(
    script,
    `import {VerificationJournal} from ${JSON.stringify(url)};
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {DockerExecution} from ${JSON.stringify(moduleUrl("dockerExecution"))};
import {DockerCommand} from ${JSON.stringify(moduleUrl("dockerCommand"))};
import {buildDockerPlan} from ${JSON.stringify(moduleUrl("dockerPlan"))};
import {NODE_REPORTER_SOURCE} from ${JSON.stringify(moduleUrl("nodeReporter"))};
const root=process.argv[2]; const workspace=join(root,'orphan'); await mkdir(workspace,{mode:0o700});
const journal=await VerificationJournal.open(join(root,'journal.sqlite'));
const record=await journal.register({runId:randomUUID(),root:workspace,endpoint:'unix:///var/run/docker.sock',executable:process.argv[5] ?? '/usr/bin/docker'});
if (process.argv[4]) {
  const source=join(workspace,'source'); await mkdir(source,{mode:0o755});
  const config=join(workspace,'config'); await mkdir(config,{mode:0o700});
  const reporter=join(workspace,'reporter.mjs'); await writeFile(reporter,NODE_REPORTER_SOURCE,{mode:0o444});
  await writeFile(join(source,'test.mjs'),"import {test} from 'node:test';test('fixture',()=>{});",{mode:0o444});
  const grant={schemaVersion:1,profile:'VERIFY',allowTargetExecution:true,environment:'local',repositoryRoot:root,snapshotId:randomUUID(),treeDigest:'1'.repeat(64),image:process.argv[4],expiresAt:new Date(Date.now()+60000).toISOString(),testFiles:['test.mjs'],limits:{timeoutMs:15000,memoryMiB:256,cpus:1,pids:32,workspaceMiB:64,outputBytes:65536,sourceBytes:100000}};
  const plan=buildDockerPlan(grant,source,reporter,record.runId); if(!plan.ok)throw plan.error;
  const execution=new DockerExecution(plan.value,new DockerCommand(record.executable,record.endpoint,config),event=>{
    journal.event(record.runId,event);
    if(event.phase==='created') process.stdout.write(JSON.stringify(journal.get(record.runId)),()=>process.exit(0));
    if(event.phase==='created') return new Promise(()=>{});
  });
  await execution.execute(); throw new Error('Fixture did not exit at created handshake');
}
if (process.argv[3] === 'creating') journal.event(record.runId,{phase:'creating',containerId:null});
process.stdout.write(JSON.stringify(record),()=>process.exit(0));
`,
  );
  const output = await promisify(execFile)(
    process.execPath,
    [script, root, phase, ...(docker ? [docker.image, docker.executable] : [])],
    { timeout: docker ? 30_000 : 10_000, maxBuffer: 100_000 },
  );
  return JSON.parse(output.stdout) as { runId: string; root: string };
}
