//! Separate-process full-graph replay verifier for local development archives.
use flypow_sim_core::{Graph, ModelMeta, Parameters, Task, encode_response, simulate_pair};
use flypow_task_catalog::{CatalogFile, MerkleTree, hex, verify_membership};
use sha2::{Digest, Sha256};
use std::{env, fs, io::Write, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 6 && args.len() != 7 {
        eprintln!(
            "usage: verify_response GRAPH.bin MODEL.bin CATALOG.json GLOBAL_TASK_INDEX RESPONSE.bin [--write-new]"
        );
        std::process::exit(2);
    }
    let write_new = args.len() == 7 && args[6] == "--write-new";
    if args.len() == 7 && !write_new {
        return Err("unknown option".into());
    }
    let started = Instant::now();
    let catalog: CatalogFile = serde_json::from_slice(&fs::read(&args[3])?)?;
    flypow_task_catalog::validate_development_science(&catalog)
        .map_err(|_| "Unknown frozen scientific profile")?;
    if catalog.state != "UNCALIBRATED_DEV_ONLY_NO_PAYMENT" {
        return Err("unknown or payable catalog state".into());
    }
    let graph_data = fs::read(&args[1])?;
    let model_data = fs::read(&args[2])?;
    let graph_hash: [u8; 32] = Sha256::digest(&graph_data).into();
    let model_hash: [u8; 32] = Sha256::digest(&model_data).into();
    if graph_hash != catalog.graph_data_sha256
        || graph_hash != catalog.campaign.graph_root
        || model_hash != catalog.model_data_sha256
    {
        return Err("model or graph bytes differ from catalog".into());
    }
    let graph = Graph::parse(&graph_data).map_err(|error| format!("graph: {error:?}"))?;
    let model =
        ModelMeta::parse(&model_data, &graph).map_err(|error| format!("model: {error:?}"))?;
    if graph.registry_root != catalog.campaign.registry_root
        || graph.neuron_count != catalog.campaign.model_neuron_count as usize
        || catalog.campaign.time_step_us != Parameters::development_v0().time_step_us
    {
        return Err("registry or simulation configuration mismatch".into());
    }
    let tree =
        MerkleTree::build(&catalog.campaign).map_err(|error| format!("catalog: {error:?}"))?;
    if tree.root() != catalog.task_manifest_root {
        return Err("task manifest root mismatch".into());
    }
    let k: u64 = args[4].parse()?;
    let descriptor = catalog
        .campaign
        .task(k)
        .map_err(|error| format!("task: {error:?}"))?;
    let proof = tree.proof(k).map_err(|error| format!("proof: {error:?}"))?;
    if !verify_membership(&catalog.campaign, &descriptor, &proof, tree.root())
        || graph.body_id(descriptor.target_index as usize) != descriptor.body_id
    {
        return Err("task is not a member of the frozen graph and catalog".into());
    }
    let task = Task {
        target_index: descriptor.target_index as usize,
        steps: catalog.campaign.simulation_steps,
        observe_start: 0,
        stimulus_start: descriptor.stimulus.start_step,
        stimulus_end: descriptor.stimulus.end_step,
        stimulus_current: descriptor.stimulus.current,
        public_seed: descriptor.simulation_seed,
    };
    let response = simulate_pair(
        &graph,
        &model.signs,
        &model.vnc,
        &model.roi_masks,
        Parameters::development_v0(),
        task,
    )
    .map_err(|error| format!("simulation: {error:?}"))?;
    let expected = encode_response(
        &response,
        graph.neuron_count as u32,
        descriptor.target_index,
        task.steps,
    )
    .map_err(|error| format!("archive: {error:?}"))?;
    if let Some(definition) = &catalog.profile_definition
        && expected.len() as u64
            > definition["resources"]["max_archive_bytes"]
                .as_u64()
                .ok_or("Missing archive budget")?
    {
        return Err("Frozen scientific archive resource limit exceeded".into());
    }
    if write_new {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&args[5])?;
        output.write_all(&expected)?;
        println!(
            "result=CREATED_DEV_ARCHIVE; task_index={k}; task_id={}; body_id={}; archive_sha256={}; elapsed_ms={}; no_on_chain_claim=true",
            hex(&descriptor.task_id),
            descriptor.body_id,
            hex(&Sha256::digest(&expected)),
            started.elapsed().as_millis()
        );
        return Ok(());
    }
    let archive = fs::read(&args[5])?;
    if expected != archive {
        return Err(format!(
            "full replay mismatch; expected_sha256={} submitted_sha256={}",
            hex(&Sha256::digest(&expected)),
            hex(&Sha256::digest(&archive))
        )
        .into());
    }
    println!(
        "result=VALID_DEV_REPLAY; task_index={k}; task_id={}; body_id={}; archive_sha256={}; elapsed_ms={}; no_on_chain_claim=true",
        hex(&descriptor.task_id),
        descriptor.body_id,
        hex(&Sha256::digest(&archive)),
        started.elapsed().as_millis()
    );
    Ok(())
}
