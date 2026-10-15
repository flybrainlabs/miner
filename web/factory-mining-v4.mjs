// Opt-in assembly of the existing full-model runner with the chain task client.
// The caller supplies a connected wallet, transaction sender and durable content
// storage. No deployment, catalog approval or spending grant is inferred here.
import {FactoryMiningClientV4,FactorySubmissionV4} from '/assets/vendor/generated/factory-wallet-v4.mjs';
import {CandidateStoreV2} from './candidate-store-v2.mjs';
import {GoalSearchRunner} from './goal-search-runner.mjs';
export async function createFactoryMiningV4({deployment,wallet,send,contentStore,connection=null,...runnerOptions}){
  let runner;const client=new FactoryMiningClientV4({deployment,wallet,send,contentStore,connection,
    onSnapshot:s=>runner?.syncRound(s),onConnection:(online,error)=>{if(!online)runner?.disconnected(error);}});
  const store=new CandidateStoreV2(client.network);store.config=runnerOptions.config;
  const submission=new FactorySubmissionV4(client,store,runnerOptions.onSubmissionChange);
  runner=new GoalSearchRunner({...runnerOptions,client,store,submission,financial:null});
  await client.initialize();return {client,store,submission,runner,dispose:async()=>{runner.dispose();await client.dispose();}};
}
