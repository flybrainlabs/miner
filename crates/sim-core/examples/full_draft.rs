use flypow_sim_core::{Graph, ModelMeta, Parameters, Task, encode_response, simulate_pair};
use std::{env, fs, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 4 && args.len() != 5 {
        eprintln!("usage: full_draft GRAPH.bin MODEL.bin REAL_BODY_ID [ARCHIVE.bin]");
        std::process::exit(2);
    }
    let body_id: u64 = args[3].parse()?;
    let graph_data = fs::read(&args[1])?;
    let graph = Graph::parse(&graph_data).map_err(|error| format!("graph error: {error:?}"))?;
    let metadata = fs::read(&args[2])?;
    let model =
        ModelMeta::parse(&metadata, &graph).map_err(|error| format!("model error: {error:?}"))?;
    let mut lower = 0;
    let mut upper = graph.neuron_count;
    while lower < upper {
        let middle = lower + (upper - lower) / 2;
        if graph.body_id(middle) < body_id {
            lower = middle + 1;
        } else {
            upper = middle;
        }
    }
    if lower == graph.neuron_count || graph.body_id(lower) != body_id {
        return Err("body ID is not in frozen registry".into());
    }
    let target_index = lower;
    let task = Task {
        target_index,
        steps: 32,
        observe_start: 0,
        stimulus_start: 4,
        stimulus_end: 12,
        stimulus_current: 200,
        public_seed: 0x4c4f43414c5f7630,
    };
    let started = Instant::now();
    let result = simulate_pair(
        &graph,
        &model.signs,
        &model.vnc,
        &model.roi_masks,
        Parameters::development_v0(),
        task,
    )
    .map_err(|error| format!("simulation error: {error:?}"))?;
    println!("state=UNCALIBRATED_DEV_ONLY; seed=LOCAL_TEST_SEED; body_id={body_id}");
    println!(
        "neuron_count={}; directed_connections={}; steps=32",
        graph.neuron_count, graph.edge_count
    );
    println!(
        "spikes_a={}; spikes_b={}; active_a={}; active_b={}; target_a={}; target_b={}",
        result.global.spikes_a,
        result.global.spikes_b,
        result.global.active_a,
        result.global.active_b,
        result.global.target_spikes_a,
        result.global.target_spikes_b
    );
    println!(
        "top_count={}; events_a={}; events_b={}; elapsed_ms={}",
        result.top_count,
        result.spikes_a.len(),
        result.spikes_b.len(),
        started.elapsed().as_millis()
    );
    for cell in result.top.iter().take(result.top_count as usize) {
        println!(
            "top body={} delta={} first_divergence_step={}",
            cell.body_id, cell.delta_spikes, cell.first_divergence_step
        );
    }
    if let Some(path) = args.get(4) {
        fs::write(
            path,
            encode_response(
                &result,
                graph.neuron_count as u32,
                target_index as u32,
                task.steps,
            )
            .map_err(|error| format!("archive error: {error:?}"))?,
        )?;
    }
    Ok(())
}
