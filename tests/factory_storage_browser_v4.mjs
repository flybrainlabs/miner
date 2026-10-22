// Browser crash acceptance uses the real store/outbox and real OPFS. The
// FBRP1 events and submission service are explicit fixtures, never live work.
import {CandidateStoreV2} from '../web/candidate-store-v2.mjs';
import {SubmissionOutboxV4} from '../web/submission-outbox-v4.mjs';
import {buildRecord} from '../web/response-record.mjs';
import {factoryRecord} from '../web/task-factory-result-v4.mjs';
import {descriptorFor, makeRound, factoryTrialTask} from '../web/task-factory-v4-science.mjs';
import {candidateId, evaluate, canonical, hex} from '../web/target-protocol-v2.mjs';

const vector = await (await fetch('/tests/vectors/target-v2.json')).json();
const config = await (await fetch('/web/data/research-profiles/duration256-v1-dev/config.json')).json();
const scenario = new URL(location.href).searchParams.get('scenario');
if (!/^[a-z-]+$/.test(scenario || '')) throw new Error('Explicit test scenario required');
const network = {protocolVersion: 4, networkId: 'browser-crash-fixture-' + scenario,
  campaignId: 'browser-crash-factory-' + scenario};
const store = new CandidateStoreV2(network);
store.config = config;
const spec = {schema: 'flybrainlabs-scientific-task-v4', goal: vector.goal,
  seeds: ['0000000000000001', '0000000000000002']};
const descriptor = await descriptorFor(spec, {rewardAtoms: '100', claimSeconds: 10,
  revealSeconds: 20, verifySeconds: 30, maxAttempts: 2});
const round = await makeRound({program: 'browser-fixture-program', genesis: network.networkId,
  factoryAddress: network.campaignId, taskAddress: 'browser-fixture-task', factory: {},
  task: {index: 0, attempt: 0, descriptor, openedAt: 1n, claimDeadline: 11n,
    revealDeadline: 21n, verifyDeadline: 31n}, spec});
const id = await candidateId(round.roundId, vector.input);
const submissions = [];
let holdSubmit = false, releaseSubmit, heldOutbox;
const context = {deployment: {factory: network.campaignId}, store,
  client: {identity: {publicKey: 'browser-fixture-wallet'}, bindWallet() {}},
  submission: {
    async reconcile() {},
    async submit(candidate) {
      submissions.push(candidate);
      if (holdSubmit) await new Promise(resolve => releaseSubmit = resolve);
      const meta = await store.metadata(candidate);
      meta.factoryV4 = {submission: 'browser-fixture-submission', miner: 'browser-fixture-wallet'};
      meta.phase = 'verifying';
      await store.update(meta);
    }
  }};
const outbox = () => new SubmissionOutboxV4({contexts: () => [context],
  canCommit: () => true, canFinish: () => true});

let armed = null;
async function boundary(point) {
  globalThis.crashBoundary = {point, candidateId: id, roundId: round.roundId};
  await new Promise(() => {});
}
// Stop at an actual browser file commit boundary, then let the Python driver
// kill the browser process. Only this fresh acceptance profile is affected.
const createWritable = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = async function (...args) {
  if (armed === 'before-response' && this.name === 'response.bin') await boundary(armed);
  const stream = await createWritable.apply(this, args);
  const close = stream.close.bind(stream), name = this.name;
  stream.close = async (...values) => {
    await close(...values);
    if ((armed === 'response-before-receipt' && name === 'response.bin') ||
        (armed === 'receipt-before-state' && name === 'complete.json') ||
        (armed === 'state-before-index' && name === 'state.json')) await boundary(armed);
  };
  return stream;
};

function fixtureBytes(task) {
  // Hand-built events test persistence and the normal evaluator only. These
  // events did not come from a native or browser complete-model simulation.
  const indices = vector.goal.responseSet.map(c => c.modelIndex).sort((a, b) => a - b);
  const end = vector.input.endStep, events = [];
  for (const step of [end + 1, end + 17, end + 18])
    for (const index of indices) events.push([step, index]);
  const bytes = new Uint8Array(480 + 8 * events.length), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('FBRP1\0\0\0'));
  view.setUint32(8, config.neuron_count, true);
  view.setUint32(12, task.targetIndex, true);
  view.setUint32(16, config.steps, true);
  view.setBigUint64(32, BigInt(events.length), true);
  view.setUint32(476, events.length, true);
  const bins = new Array(32).fill(0);
  for (const [i, [step, index]] of events.entries()) {
    view.setUint32(480 + i * 8, step, true);
    view.setUint32(484 + i * 8, index, true);
    bins[Math.floor(step * 32 / config.steps)]++;
  }
  bins.forEach((value, i) => view.setInt32(216 + 4 * i, value, true));
  return bytes;
}

async function result(index) {
  const task = await factoryTrialTask(round, vector.input, index), bytes = fixtureBytes(task);
  const bundle = await factoryRecord(await buildRecord(bytes, config, task,
    body => vector.goal.stimulusSet.find(c => c.bodyId === String(body)).modelIndex), task, round);
  const metrics = await evaluate(vector.goal, vector.input, bytes);
  if (!metrics.passed) throw new Error('Synthetic storage fixture must exercise the passing outbox path');
  return {...bundle, task, config, archive: new Blob([bytes]), responseBytes: bytes.length,
    resultHash: bundle.resultRoot, goalMetrics: metrics};
}

async function prepare(point) {
  const meta = await store.begin(round, vector.input, id);
  meta.executionScope = {walletIdentity: 'browser-fixture-wallet'};
  await store.update(meta);
  const first = await result(0), second = await result(1);
  if (['before-response', 'response-before-receipt', 'receipt-before-state'].includes(point)) {
    armed = point;
    await store.saveTrial(meta, first);
  } else {
    await store.saveTrial(meta, first);
    armed = point === 'state-before-index' ? point : null;
    await store.saveTrial(meta, second);
    await store.repair(meta);
    if (point === 'saved-before-enqueue') await boundary(point);
    await outbox().enqueue(store, meta);
    if (point === 'enqueued-before-drive') await boundary(point);
  }
  throw new Error('Expected a crash boundary');
}

async function inspect() {
  const rows = await store.list(), meta = rows.find(row => row.candidateId === id);
  if (!meta) throw new Error('Original candidate metadata was lost');
  if (meta.roundId !== round.roundId || hex(canonical(meta.input)) !== hex(canonical(vector.input)))
    throw new Error('Recovered candidate identity changed');
  const trials = [];
  for (let i = 0; i < meta.trials.length; i++) {
    const bundle = await store.bundle(meta, i);
    trials.push({trialId: bundle.task.trialId, repeatIndex: i,
      resultRoot: bundle.resultHash, bytes: bundle.responseBytes});
  }
  let retainedResponseBytes = 0;
  for await (const [name, handle] of (await store.candidate(id, false)).entries()) {
    if (handle.kind !== 'directory' || !/^[a-f0-9]{64}$/.test(name)) continue;
    try {
      retainedResponseBytes += (await (await handle.getFileHandle('response.bin')).getFile()).size;
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
    }
  }
  return {candidateId: meta.candidateId, roundId: meta.roundId, partial: meta.partial,
    sciencePassed: meta.sciencePassed, archiveSaved: meta.archiveSaved,
    outboxRecorded: !!meta.outbox, trials, retainedResponseBytes, count: rows.length};
}

async function recoverOutbox() {
  const box = outbox();
  await box.tick();
  await Promise.all(box.active.values());
  await box.tick();
  await Promise.all(box.active.values());
  return {submissions: [...submissions], snapshot: box.snapshot(), state: await inspect()};
}

async function holdOutbox() {
  holdSubmit = true;
  heldOutbox = outbox();
  await heldOutbox.tick();
}

async function finishOutbox() {
  if (!releaseSubmit) throw new Error('Fixture submission did not hold the real Web Lock');
  releaseSubmit();
  await Promise.all(heldOutbox.active.values());
  return {submissions: [...submissions]};
}

globalThis.storageAcceptance = {prepare, inspect, recoverOutbox, holdOutbox, finishOutbox,
  get held() { return !!releaseSubmit; }};
globalThis.storageAcceptanceReady = true;
