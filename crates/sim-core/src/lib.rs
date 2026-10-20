//! Deterministic whole-registry point-neuron A/B experiment core.
//!
//! All numeric constants below are model assumptions, not official physiology.
//! The same Rust implementation can compile for native and wasm32 targets.
use flypow_receipt_v1::{GlobalSummary, TopNeuron};
use sha2::{Digest, Sha256};

mod session;
pub use session::{CellTrace, SimSession, TRACE_ROW_BYTES};
mod abi_session;
pub use abi_session::*;

const MAGIC: &[u8; 8] = b"FBGR1\0\0\0";
const HEADER_BYTES: usize = 52;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimError {
    GraphFormat,
    GraphIdentity,
    GraphRange,
    ModelShape,
    TaskRange,
    NumericRange,
    ResourceLimit,
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("validated graph offset"),
    )
}
fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("validated graph offset"),
    )
}

/// Borrowed CSR view; the caller retains ownership of the verified graph bytes.
pub struct Graph<'a> {
    bytes: &'a [u8],
    pub neuron_count: usize,
    pub edge_count: usize,
    pub registry_root: [u8; 32],
    offsets_start: usize,
    edges_start: usize,
}

pub struct ModelMeta {
    pub signs: Vec<i8>,
    pub vnc: Vec<bool>,
    pub roi_masks: Vec<u16>,
}

impl ModelMeta {
    pub fn parse(bytes: &[u8], graph: &Graph<'_>) -> Result<Self, SimError> {
        let n = graph.neuron_count;
        if bytes.len() != 44 + 4 * n
            || &bytes[..8] != b"FBMD1\0\0\0"
            || u32_at(bytes, 8) as usize != n
        {
            return Err(SimError::ModelShape);
        }
        let graph_hash: [u8; 32] = Sha256::digest(graph.bytes).into();
        if bytes[12..44] != graph_hash {
            return Err(SimError::GraphIdentity);
        }
        let signs: Vec<i8> = bytes[44..44 + n].iter().map(|byte| *byte as i8).collect();
        let vnc: Vec<bool> = bytes[44 + n..44 + 2 * n]
            .iter()
            .map(|byte| *byte == 1)
            .collect();
        if bytes[44 + n..44 + 2 * n].iter().any(|byte| *byte > 1) {
            return Err(SimError::ModelShape);
        }
        let roi_masks: Vec<u16> = bytes[44 + 2 * n..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        if signs.iter().any(|sign| *sign != 1 && *sign != -1)
            || roi_masks
                .iter()
                .zip(&vnc)
                .any(|(mask, member)| *mask != u16::from(*member))
        {
            return Err(SimError::ModelShape);
        }
        Ok(Self {
            signs,
            vnc,
            roi_masks,
        })
    }
}

impl<'a> Graph<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, SimError> {
        if bytes.len() < HEADER_BYTES || &bytes[..8] != MAGIC {
            return Err(SimError::GraphFormat);
        }
        let neuron_count = u32_at(bytes, 8) as usize;
        let edge_count = usize::try_from(u64_at(bytes, 12)).map_err(|_| SimError::GraphRange)?;
        if neuron_count == 0 || edge_count == 0 || neuron_count > u32::MAX as usize {
            return Err(SimError::GraphRange);
        }
        let offsets_start = HEADER_BYTES
            .checked_add(neuron_count.checked_mul(8).ok_or(SimError::GraphRange)?)
            .ok_or(SimError::GraphRange)?;
        let edges_start = offsets_start
            .checked_add(
                (neuron_count + 1)
                    .checked_mul(8)
                    .ok_or(SimError::GraphRange)?,
            )
            .ok_or(SimError::GraphRange)?;
        let expected = edges_start
            .checked_add(edge_count.checked_mul(8).ok_or(SimError::GraphRange)?)
            .ok_or(SimError::GraphRange)?;
        if bytes.len() != expected {
            return Err(SimError::GraphFormat);
        }
        let mut registry_root = [0; 32];
        registry_root.copy_from_slice(&bytes[20..52]);
        let graph = Self {
            bytes,
            neuron_count,
            edge_count,
            registry_root,
            offsets_start,
            edges_start,
        };
        if graph.offset(0) != 0 || graph.offset(neuron_count) != edge_count {
            return Err(SimError::GraphRange);
        }
        for index in 0..neuron_count {
            if (index > 0 && graph.body_id(index - 1) >= graph.body_id(index))
                || graph.offset(index) > graph.offset(index + 1)
                || graph.offset(index + 1) > edge_count
            {
                return Err(SimError::GraphRange);
            }
        }
        for source in 0..neuron_count {
            let mut previous_target = None;
            for index in graph.offset(source)..graph.offset(source + 1) {
                let (target, weight) = graph.edge(index);
                if target >= neuron_count
                    || weight == 0
                    || previous_target.is_some_and(|previous| target <= previous)
                {
                    return Err(SimError::GraphRange);
                }
                previous_target = Some(target);
            }
        }
        Ok(graph)
    }

    pub fn body_id(&self, index: usize) -> u64 {
        u64_at(self.bytes, HEADER_BYTES + index * 8)
    }
    pub fn offset(&self, index: usize) -> usize {
        u64_at(self.bytes, self.offsets_start + index * 8) as usize
    }
    pub fn edge(&self, index: usize) -> (usize, u32) {
        let start = self.edges_start + index * 8;
        (
            u32_at(self.bytes, start) as usize,
            u32_at(self.bytes, start + 4),
        )
    }
}

/// V0 explicit assumptions. 1 step of synaptic delay, units are model current.
#[derive(Debug, Clone, Copy)]
pub struct Parameters {
    pub time_step_us: u32,
    pub leak_divisor: i64,
    pub threshold: i64,
    pub reset: i64,
    pub membrane_limit: i64,
    pub refractory_steps: u8,
    pub synaptic_unit: i64,
    pub background_probability_u16: u16,
    pub background_current: i64,
}

impl Parameters {
    pub fn development_v0() -> Self {
        Self {
            time_step_us: 1_000,
            leak_divisor: 8,
            threshold: 100,
            reset: 0,
            membrane_limit: 1_000_000,
            refractory_steps: 2,
            synaptic_unit: 1,
            background_probability_u16: 256,
            background_current: 10,
        }
    }
    fn validate(self) -> Result<(), SimError> {
        if self.time_step_us == 0
            || self.leak_divisor <= 0
            || self.threshold <= 0
            || self.membrane_limit < self.threshold
            || self.refractory_steps > 32
            || self.synaptic_unit <= 0
            || self.background_current < 0
            || self
                .reset
                .checked_abs()
                .is_none_or(|value| value > self.membrane_limit)
        {
            return Err(SimError::ModelShape);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Task {
    pub target_index: usize,
    pub steps: u32,
    pub observe_start: u32,
    pub stimulus_start: u32,
    pub stimulus_end: u32,
    pub stimulus_current: i64,
    pub public_seed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpikeEvent {
    pub step: u32,
    pub neuron_index: u32,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub global: GlobalSummary,
    pub roi_delta_spikes: [i64; 16],
    pub population_delta_by_bin: [i32; 32],
    pub top: [TopNeuron; 8],
    pub top_count: u8,
    pub spikes_a: Vec<SpikeEvent>,
    pub spikes_b: Vec<SpikeEvent>,
}

/// Completed work only. Both control and stimulus updates are counted.
/// A synapse transmission is one actual addition to an A or B delay buffer,
/// not the number of connections in the graph or a floating point operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimProgress {
    pub completed_steps: u32,
    pub total_steps: u32,
    pub neuron_updates: u64,
    pub synapse_transmissions: u64,
    pub observed_spikes_a: u64,
    pub observed_spikes_b: u64,
}

/// SplitMix64 with specified wrapping operations; deterministic across targets.
fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

#[derive(Clone, Copy)]
struct TickOutcome {
    spike: bool,
    leaked: i64,
    integrated: i64,
}
fn tick(
    mem: &mut i64,
    refractory: &mut u8,
    drive: i64,
    config: Parameters,
) -> Result<TickOutcome, SimError> {
    if *refractory != 0 {
        *refractory -= 1;
        *mem = config.reset;
        return Ok(TickOutcome {
            spike: false,
            leaked: config.reset,
            integrated: config.reset,
        });
    }
    let leaked = mem
        .checked_sub(mem.div_euclid(config.leak_divisor))
        .ok_or(SimError::NumericRange)?;
    let next = leaked.checked_add(drive).ok_or(SimError::NumericRange)?;
    *mem = next.clamp(-config.membrane_limit, config.membrane_limit);
    if *mem >= config.threshold {
        *mem = config.reset;
        *refractory = config.refractory_steps;
        Ok(TickOutcome {
            spike: true,
            leaked,
            integrated: next.clamp(-config.membrane_limit, config.membrane_limit),
        })
    } else {
        Ok(TickOutcome {
            spike: false,
            leaked,
            integrated: *mem,
        })
    }
}

/// `signs` values are -1/+1 modeling choices for each registered presynaptic cell.
/// `vnc` and `roi_masks` come from the frozen readout manifest, one entry per cell.
pub fn simulate_pair(
    graph: &Graph<'_>,
    signs: &[i8],
    vnc: &[bool],
    roi_masks: &[u16],
    config: Parameters,
    task: Task,
) -> Result<Response, SimError> {
    simulate_pair_observed(graph, signs, vnc, roi_masks, config, task, |_| {})
}

/// The observer runs after initialization and each completed model time step.
/// It receives counters without access to mutable simulation state.
pub fn simulate_pair_observed(
    graph: &Graph<'_>,
    signs: &[i8],
    vnc: &[bool],
    roi_masks: &[u16],
    config: Parameters,
    task: Task,
    mut observer: impl FnMut(SimProgress),
) -> Result<Response, SimError> {
    let mut session = SimSession::new(
        graph,
        signs,
        vnc,
        roi_masks,
        config,
        task,
        u32::MAX as usize,
        &[],
        0,
    )?;
    observer(session.progress());
    while !session.advance(65536, &mut observer)? {}
    session.finalize()
}

/// A compact versioned response archive used by the browser Worker.
/// This retains all spike events; it is not the 1024-byte chain receipt.
pub fn encode_response(
    response: &Response,
    neuron_count: u32,
    target_index: u32,
    steps: u32,
) -> Result<Vec<u8>, SimError> {
    let mut bytes = encode_response_header(response, neuron_count, target_index, steps)?;
    bytes
        .try_reserve(response_length(response)? as usize - 480)
        .map_err(|_| SimError::ResourceLimit)?;
    for event in response.spikes_a.iter().chain(&response.spikes_b) {
        bytes.extend_from_slice(&event.step.to_le_bytes());
        bytes.extend_from_slice(&event.neuron_index.to_le_bytes());
    }
    Ok(bytes)
}
fn encode_response_header(
    response: &Response,
    neuron_count: u32,
    target_index: u32,
    steps: u32,
) -> Result<Vec<u8>, SimError> {
    let a_count = u32::try_from(response.spikes_a.len()).map_err(|_| SimError::NumericRange)?;
    let b_count = u32::try_from(response.spikes_b.len()).map_err(|_| SimError::NumericRange)?;
    let mut bytes = Vec::with_capacity(480);
    bytes.extend_from_slice(b"FBRP1\0\0\0");
    bytes.extend_from_slice(&neuron_count.to_le_bytes());
    bytes.extend_from_slice(&target_index.to_le_bytes());
    bytes.extend_from_slice(&steps.to_le_bytes());
    bytes.push(response.top_count);
    bytes.extend_from_slice(&[0; 3]);
    for value in [
        response.global.spikes_a,
        response.global.spikes_b,
        response.global.active_a,
        response.global.active_b,
        response.global.target_spikes_a,
        response.global.target_spikes_b,
        response.global.vnc_spikes_a,
        response.global.vnc_spikes_b,
    ] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in response.roi_delta_spikes {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in response.population_delta_by_bin {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    for value in response.top {
        bytes.extend_from_slice(&value.body_id.to_le_bytes());
        bytes.extend_from_slice(&value.delta_spikes.to_le_bytes());
        bytes.extend_from_slice(&value.first_divergence_step.to_le_bytes());
    }
    bytes.extend_from_slice(&a_count.to_le_bytes());
    bytes.extend_from_slice(&b_count.to_le_bytes());
    Ok(bytes)
}

/// Minimal C ABI for wasm32-unknown-unknown. The browser Worker owns all buffers.
/// Each pointer returned by `flypow_alloc` or `flypow_run` must be freed once.
#[unsafe(no_mangle)]
/// # Safety
/// Input names `length` readable bytes; output names exactly 1024 writable bytes.
pub unsafe extern "C" fn flypow_receipt_roundtrip(
    input: *const u8,
    length: u32,
    output: *mut u8,
) -> u32 {
    if input.is_null() || output.is_null() || length != 1024 {
        return 0;
    }
    // SAFETY: the caller supplies both fixed-size allocations.
    let bytes = unsafe { std::slice::from_raw_parts(input, length as usize) };
    let Ok(record) = flypow_receipt_v1::SubmissionV1::decode_account(bytes) else {
        return 0;
    };
    let Ok(encoded) = record.encode_account() else {
        return 0;
    };
    unsafe {
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), output, 1024);
    }
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn flypow_alloc(length: u32) -> *mut u8 {
    if length == 0 {
        return std::ptr::null_mut();
    }
    let Ok(layout) = std::alloc::Layout::array::<u8>(length as usize) else {
        return std::ptr::null_mut();
    };
    // SAFETY: layout is nonzero and checked above; caller owns the resulting allocation.
    unsafe { std::alloc::alloc(layout) }
}

#[unsafe(no_mangle)]
/// # Safety
/// `pointer` and `length` must be the exact allocation returned by flypow_alloc or flypow_run.
pub unsafe extern "C" fn flypow_free(pointer: *mut u8, length: u32) {
    if pointer.is_null() || length == 0 {
        return;
    }
    if let Ok(layout) = std::alloc::Layout::array::<u8>(length as usize) {
        // SAFETY: caller must pass the exact pointer and length from flypow_alloc/run.
        unsafe {
            std::alloc::dealloc(pointer, layout);
        }
    }
}

#[unsafe(no_mangle)]
/// # Safety
/// `pointer` must name `length` readable bytes and `output` must name 32 writable bytes.
pub unsafe extern "C" fn flypow_sha256(pointer: *const u8, length: u32, output: *mut u8) -> u32 {
    if pointer.is_null() || output.is_null() {
        return 0;
    }
    // SAFETY: the caller provides an allocated input of `length` bytes and 32 output bytes.
    let data = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let digest: [u8; 32] = Sha256::digest(data).into();
    unsafe {
        std::ptr::copy_nonoverlapping(digest.as_ptr(), output, 32);
    }
    1
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "flypow")]
unsafe extern "C" {
    fn progress(
        completed_steps: u32,
        total_steps: u32,
        neuron_updates: u64,
        synapse_transmissions: u64,
        observed_spikes_a: u64,
        observed_spikes_b: u64,
    );
}

fn report_wasm_progress(value: SimProgress) {
    #[cfg(target_arch = "wasm32")]
    // SAFETY: the Worker supplies this observational, synchronous import. It
    // only sends counters to the page; it cannot mutate the simulation buffers.
    unsafe {
        progress(
            value.completed_steps,
            value.total_steps,
            value.neuron_updates,
            value.synapse_transmissions,
            value.observed_spikes_a,
            value.observed_spikes_b,
        );
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = value;
}

#[unsafe(no_mangle)]
/// # Safety
/// Input pointers must name their declared readable lengths and `output_length` must name
/// four writable bytes. The caller must keep inputs alive and free the returned buffer.
pub unsafe extern "C" fn flypow_run(
    graph_pointer: *const u8,
    graph_length: u32,
    model_pointer: *const u8,
    model_length: u32,
    body_id: u64,
    steps: u32,
    stimulus_start: u32,
    stimulus_end: u32,
    stimulus_current: i64,
    seed: u64,
    output_length: *mut u32,
) -> *mut u8 {
    if graph_pointer.is_null() || model_pointer.is_null() || output_length.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: the single-threaded Worker owns both allocations for this call.
    let graph_data = unsafe { std::slice::from_raw_parts(graph_pointer, graph_length as usize) };
    let model_data = unsafe { std::slice::from_raw_parts(model_pointer, model_length as usize) };
    let Ok(graph) = Graph::parse(graph_data) else {
        return std::ptr::null_mut();
    };
    let Ok(model) = ModelMeta::parse(model_data, &graph) else {
        return std::ptr::null_mut();
    };
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
        return std::ptr::null_mut();
    }
    let task = Task {
        target_index: lower,
        steps,
        observe_start: 0,
        stimulus_start,
        stimulus_end,
        stimulus_current,
        public_seed: seed,
    };
    let Ok(response) = simulate_pair_observed(
        &graph,
        &model.signs,
        &model.vnc,
        &model.roi_masks,
        Parameters::development_v0(),
        task,
        report_wasm_progress,
    ) else {
        return std::ptr::null_mut();
    };
    let Ok(encoded) = encode_response(&response, graph.neuron_count as u32, lower as u32, steps)
    else {
        return std::ptr::null_mut();
    };
    let Ok(length) = u32::try_from(encoded.len()) else {
        return std::ptr::null_mut();
    };
    let output = flypow_alloc(length);
    if output.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: output was allocated with exactly `length` bytes above.
    unsafe {
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), output, encoded.len());
        *output_length = length;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_graph() -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&3_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u64.to_le_bytes());
        bytes.extend_from_slice(&[9; 32]);
        for body in [1_u64, 2, 3] {
            bytes.extend_from_slice(&body.to_le_bytes());
        }
        for offset in [0_u64, 1, 2, 2] {
            bytes.extend_from_slice(&offset.to_le_bytes());
        }
        for target in [1_u32, 2] {
            bytes.extend_from_slice(&target.to_le_bytes());
            bytes.extend_from_slice(&100_u32.to_le_bytes());
        }
        bytes
    }

    fn task(current: i64) -> Task {
        Task {
            target_index: 0,
            steps: 32,
            observe_start: 0,
            stimulus_start: 0,
            stimulus_end: 1,
            stimulus_current: current,
            public_seed: 123,
        }
    }

    #[test]
    fn full_graph_ab_propagation_and_no_response() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let mut parameters = Parameters::development_v0();
        parameters.background_probability_u16 = 0;
        parameters.refractory_steps = 0;
        let output = simulate_pair(
            &graph,
            &[1, 1, 1],
            &[false, false, true],
            &[1, 1, 2],
            parameters,
            task(100),
        )
        .unwrap();
        assert_eq!(output.global.spikes_a, 0);
        assert_eq!(output.global.spikes_b, 3);
        assert_eq!(output.global.active_b, 3);
        assert_eq!(output.global.target_spikes_b, 1);
        assert_eq!(output.global.vnc_spikes_b, 1);
        assert_eq!(
            output.spikes_b,
            vec![
                SpikeEvent {
                    step: 0,
                    neuron_index: 0
                },
                SpikeEvent {
                    step: 1,
                    neuron_index: 1
                },
                SpikeEvent {
                    step: 2,
                    neuron_index: 2
                }
            ]
        );
        assert_eq!(output.roi_delta_spikes[0], 2);
        assert_eq!(output.roi_delta_spikes[1], 1);
        assert_eq!(&output.population_delta_by_bin[..3], &[1, 1, 1]);
        assert_eq!(output.top_count, 3);
        assert_eq!(output.top[0].body_id, 1);
        assert_eq!(output.top[0].first_divergence_step, 0);
        let again = simulate_pair(
            &graph,
            &[1, 1, 1],
            &[false, false, true],
            &[1, 1, 2],
            parameters,
            task(100),
        )
        .unwrap();
        assert_eq!(again.spikes_b, output.spikes_b);
        let no_response = simulate_pair(
            &graph,
            &[1, 1, 1],
            &[false; 3],
            &[0; 3],
            parameters,
            task(0),
        )
        .unwrap();
        assert_eq!(no_response.top_count, 0);
        assert_eq!(no_response.global.spikes_a, no_response.global.spikes_b);
    }

    #[test]
    fn observer_counts_completed_work_without_changing_response() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let mut parameters = Parameters::development_v0();
        parameters.background_probability_u16 = 0;
        parameters.refractory_steps = 0;
        let mut samples = Vec::new();
        let output = simulate_pair_observed(
            &graph,
            &[1; 3],
            &[false, false, true],
            &[1, 1, 2],
            parameters,
            task(100),
            |value| samples.push(value),
        )
        .unwrap();
        let reference = simulate_pair(
            &graph,
            &[1; 3],
            &[false, false, true],
            &[1, 1, 2],
            parameters,
            task(100),
        )
        .unwrap();
        assert_eq!(
            encode_response(&output, 3, 0, 32),
            encode_response(&reference, 3, 0, 32)
        );
        assert_eq!(samples.len(), 33);
        for (step, sample) in samples.iter().enumerate() {
            assert_eq!(sample.completed_steps, step as u32);
            assert_eq!(sample.total_steps, 32);
            assert_eq!(sample.neuron_updates, 6 * step as u64);
        }
        // Only two edges carry spikes in this three-cell chain. Counting all
        // edges on every step would falsely report 128 A/B transmissions.
        let last = samples.last().unwrap();
        assert_eq!(last.synapse_transmissions, 2);
        assert_eq!(last.observed_spikes_a, 0);
        assert_eq!(last.observed_spikes_b, 3);
        assert_eq!(samples[0].synapse_transmissions, 0);
        assert_eq!(samples[1].synapse_transmissions, 1);
        assert_eq!(samples[2].synapse_transmissions, 2);
        assert_eq!(samples[3].observed_spikes_b, 3);

        // Warmup transmissions still count as work, while reported spikes
        // preserve the scientific observation window.
        let mut last = samples[0];
        simulate_pair_observed(
            &graph,
            &[1; 3],
            &[false; 3],
            &[0; 3],
            parameters,
            Task {
                observe_start: 2,
                ..task(100)
            },
            |value| last = value,
        )
        .unwrap();
        assert_eq!(last.synapse_transmissions, 2);
        assert_eq!(last.observed_spikes_b, 1);
    }

    #[test]
    fn invalid_experiment_never_reports_completed_work() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let mut reported = false;
        let invalid = Task {
            target_index: 3,
            ..task(100)
        };
        assert!(
            simulate_pair_observed(
                &graph,
                &[1; 3],
                &[false; 3],
                &[0; 3],
                Parameters::development_v0(),
                invalid,
                |_| reported = true,
            )
            .is_err()
        );
        assert!(!reported);
    }

    #[test]
    fn malformed_mapping_or_graph_is_rejected() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        assert!(matches!(
            simulate_pair(
                &graph,
                &[1, 1],
                &[false; 3],
                &[0; 3],
                Parameters::development_v0(),
                task(100)
            ),
            Err(SimError::ModelShape)
        ));
        let bad_task = Task {
            target_index: 3,
            ..task(100)
        };
        assert!(matches!(
            simulate_pair(
                &graph,
                &[1; 3],
                &[false; 3],
                &[0; 3],
                Parameters::development_v0(),
                bad_task
            ),
            Err(SimError::TaskRange)
        ));
        let mut corrupt = bytes.clone();
        corrupt[0] ^= 1;
        assert!(matches!(Graph::parse(&corrupt), Err(SimError::GraphFormat)));
        corrupt = bytes.clone();
        corrupt.pop();
        assert!(matches!(Graph::parse(&corrupt), Err(SimError::GraphFormat)));
    }

    #[test]
    fn slices_trace_and_pause_preserve_exact_scientific_bytes() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let mut p = Parameters::development_v0();
        p.background_probability_u16 = 0;
        p.refractory_steps = 0;
        let reference = simulate_pair(&graph, &[1; 3], &[false; 3], &[0; 3], p, task(100)).unwrap();
        let expected = encode_response(&reference, 3, 0, 32).unwrap();
        for budget in [1, 2, 3, 7, 99, 65536] {
            let mut session = SimSession::new(
                &graph,
                &[1; 3],
                &[false; 3],
                &[0; 3],
                p,
                task(100),
                1024,
                &[0, 1, 2],
                192,
            )
            .unwrap();
            let initial = session.progress();
            session.advance(1, |_| {}).unwrap();
            assert_eq!(session.progress(), initial); // a half step is not a completed step
            while !session.advance(budget, |_| {}).unwrap() {}
            assert_eq!(session.trace.len(), 192);
            assert!(session.trace.iter().any(|r| r.step == 1
                && r.index == 1
                && r.lane == 1
                && r.incoming == 100
                && r.spike));
            assert!(session.trace.iter().any(|r| r.step == 2
                && r.index == 2
                && r.lane == 1
                && r.incoming == 100
                && r.spike));
            assert_eq!(
                encode_response(&session.finalize().unwrap(), 3, 0, 32).unwrap(),
                expected
            );
        }
        let mut streamed = Vec::new();
        let mut buffer = [0_u8; 13];
        while streamed.len() < expected.len() {
            let count =
                write_response_range(&reference, 3, 0, 32, streamed.len(), &mut buffer).unwrap();
            streamed.extend_from_slice(&buffer[..count]);
        }
        assert_eq!(streamed, expected);
    }

    #[test]
    fn fork_convergence_inhibition_and_refractory_are_real_core_observations() {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&4_u32.to_le_bytes());
        bytes.extend_from_slice(&4_u64.to_le_bytes());
        bytes.extend_from_slice(&[9; 32]);
        for id in [1_u64, 2, 3, 4] {
            bytes.extend_from_slice(&id.to_le_bytes());
        }
        for offset in [0_u64, 2, 3, 4, 4] {
            bytes.extend_from_slice(&offset.to_le_bytes());
        }
        for (target, weight) in [(1_u32, 100_u32), (2, 100), (3, 100), (3, 100)] {
            bytes.extend_from_slice(&target.to_le_bytes());
            bytes.extend_from_slice(&weight.to_le_bytes());
        }
        let graph = Graph::parse(&bytes).unwrap();
        let mut p = Parameters::development_v0();
        p.background_probability_u16 = 0;
        for inhibitory in [false, true] {
            let signs = [1, 1, if inhibitory { -1 } else { 1 }, 1];
            let mut session = SimSession::new(
                &graph,
                &signs,
                &[false; 4],
                &[0; 4],
                p,
                task(100),
                4096,
                &[0, 1, 2, 3],
                256,
            )
            .unwrap();
            while !session.advance(2, |_| {}).unwrap() {}
            let state = session
                .trace
                .iter()
                .find(|r| r.lane == 1 && r.step == 2 && r.index == 3)
                .unwrap();
            assert_eq!(state.incoming, if inhibitory { 0 } else { 200 });
            assert_eq!(state.spike, !inhibitory);
            let refractory = session
                .trace
                .iter()
                .find(|r| r.lane == 1 && r.step == 1 && r.index == 0)
                .unwrap();
            assert_eq!(refractory.refractory_before, 2);
            assert_eq!(refractory.refractory_after, 1);
            assert!(!refractory.spike);
        }
        let mut silent = SimSession::new(
            &graph,
            &[1; 4],
            &[false; 4],
            &[0; 4],
            p,
            task(0),
            4096,
            &[0, 1, 2, 3],
            256,
        )
        .unwrap();
        while !silent.advance(1, |_| {}).unwrap() {}
        assert!(silent.trace.iter().all(|r| !r.spike));
    }

    #[test]
    fn caps_do_not_truncate_or_accept_unfinished_results() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let mut p = Parameters::development_v0();
        p.background_probability_u16 = 0;
        p.refractory_steps = 0;
        let session = SimSession::new(
            &graph,
            &[1; 3],
            &[false; 3],
            &[0; 3],
            p,
            task(100),
            1024,
            &[],
            0,
        )
        .unwrap();
        assert!(session.finalize().is_err());
        let mut session = SimSession::new(
            &graph,
            &[1; 3],
            &[false; 3],
            &[0; 3],
            p,
            task(100),
            480,
            &[],
            0,
        )
        .unwrap();
        assert_eq!(
            session.advance(65536, |_| {}).unwrap_err(),
            SimError::ResourceLimit
        );
    }

    #[test]
    fn exact_events_match_dense_archives_and_traces_across_signed_networks() {
        // Deterministic cyclic graphs exercise cancellation, negative potentials,
        // delayed revisits, clipping, refractory ticks and dense propagation.
        for seed in 0..48_u64 {
            let n = 7;
            let mut edges = Vec::new();
            let mut offsets = vec![0_u64];
            for source in 0..n {
                for target in 0..n {
                    let r = splitmix64(seed ^ (source * n + target) as u64);
                    if r % 3 != 0 {
                        edges.push((target as u32, [1, 40, 100, 999][(r % 4) as usize]));
                    }
                }
                offsets.push(edges.len() as u64);
            }
            let mut bytes = MAGIC.to_vec();
            bytes.extend_from_slice(&(n as u32).to_le_bytes());
            bytes.extend_from_slice(&(edges.len() as u64).to_le_bytes());
            bytes.extend_from_slice(&[9; 32]);
            for i in 0..n { bytes.extend_from_slice(&(i as u64 + 1).to_le_bytes()); }
            for o in offsets { bytes.extend_from_slice(&o.to_le_bytes()); }
            for (target, weight) in edges {
                bytes.extend_from_slice(&target.to_le_bytes());
                bytes.extend_from_slice(&u32::to_le_bytes(weight));
            }
            let graph = Graph::parse(&bytes).unwrap();
            let signs: Vec<_> = (0..n).map(|i| if (seed + i as u64) % 3 == 0 { -1 } else { 1 }).collect();
            let vnc: Vec<_> = (0..n).map(|i| i % 2 == 0).collect();
            let rois: Vec<_> = (0..n).map(|i| 1 << (i % 3)).collect();
            let p = Parameters { background_probability_u16: if seed % 2 == 0 { u16::MAX } else { 256 },
                membrane_limit: 200, refractory_steps: (seed % 4) as u8, reset: if seed % 5 == 0 { -150 } else { 0 },
                ..Parameters::development_v0() };
            let t = Task { target_index: (seed as usize) % n, steps: 64,
                stimulus_start: (seed % 8) as u32, stimulus_end: 16,
                observe_start: (seed % 3) as u32, stimulus_current: [0, 90, 100, 900][seed as usize % 4],
                public_seed: seed, ..task(100) };
            for selection in [&[][..], &[0, 3, 6][..]] {
                let mut dense = SimSession::new(&graph, &signs, &vnc, &rois, p, t, 1 << 20, selection, 1024).unwrap();
                let mut fast = SimSession::new(&graph, &signs, &vnc, &rois, p, t, 1 << 20, selection, 1024).unwrap();
                fast.enable_sparse().unwrap();
                while !dense.advance(17, |_| {}).unwrap() {}
                let mut boundaries = 0;
                while !fast.advance((seed as usize % 19) + 1, |_| boundaries += 1).unwrap() {}
                assert_eq!(boundaries, 64);
                assert_eq!(fast.trace, dense.trace, "seed {seed}");
                assert_eq!(fast.work_synapse_additions(), dense.work_synapse_additions());
                assert!(fast.progress().neuron_updates <= dense.progress().neuron_updates);
                let encode = |s: SimSession<'_>| encode_response(&s.finalize().unwrap(), n as u32, t.observe_start, t.steps).unwrap();
                assert_eq!(encode(fast), encode(dense), "seed {seed}");
            }
        }
    }

    #[test]
    fn sparse_admission_limits_and_empty_frontiers_are_explicit() {
        let bytes = tiny_graph();
        let graph = Graph::parse(&bytes).unwrap();
        let make = |p, t, cap| SimSession::new(&graph, &[1; 3], &[false; 3], &[0; 3], p, t, cap, &[], 0).unwrap();
        let p = Parameters::development_v0();
        let mut unsafe_session = make(Parameters { background_current: 20, ..p }, task(100), 4096);
        assert_eq!(unsafe_session.enable_sparse(), Err(SimError::ModelShape));
        let mut midway = make(p, task(100), 4096);
        midway.advance(1, |_| {}).unwrap();
        assert_eq!(midway.enable_sparse(), Err(SimError::ModelShape));
        let mut empty = make(p, task(0), 4096);
        empty.enable_sparse().unwrap();
        empty.advance(1, |_| {}).unwrap();
        assert!(!empty.done());
        while !empty.advance(1, |_| {}).unwrap() {}
        assert_eq!(empty.progress().neuron_updates, 1);
        let mut capped = make(p, task(100), 480);
        capped.enable_sparse().unwrap();
        assert_eq!(capped.advance(65536, |_| {}), Err(SimError::ResourceLimit));
    }

    #[test]
    fn sparse_long_gaps_and_inhibitory_revisits_remain_exact_without_fallback() {
        let n=64_u32;
        let mut bytes=MAGIC.to_vec();bytes.extend_from_slice(&n.to_le_bytes());bytes.extend_from_slice(&5_u64.to_le_bytes());bytes.extend_from_slice(&[9;32]);
        for i in 0..n {bytes.extend_from_slice(&(u64::from(i)+1).to_le_bytes());}
        for i in 0..=n {bytes.extend_from_slice(&(match i {0=>0_u64,1=>2,2=>3,3=>4,_=>5}).to_le_bytes());}
        for (target,weight) in [(1_u32,100_u32),(2,90),(3,100),(3,100),(4,100)] {bytes.extend_from_slice(&target.to_le_bytes());bytes.extend_from_slice(&weight.to_le_bytes());}
        let graph=Graph::parse(&bytes).unwrap();let mut signs=vec![1;64];signs[2]=-1;
        let rois=vec![1;64];let vnc=vec![false;64];
        for seed in 0..16_u64 {for probability in [256,32768,u16::MAX] {
            let p=Parameters{background_probability_u16:probability,membrane_limit:120,..Parameters::development_v0()};
            let t=Task{steps:256,stimulus_start:32,stimulus_end:160,public_seed:seed,..task(150)};
            let mut dense=SimSession::new(&graph,&signs,&vnc,&rois,p,t,1<<20,&[3,4,63],1536).unwrap();
            let mut fast=SimSession::new(&graph,&signs,&vnc,&rois,p,t,1<<20,&[3,4,63],1536).unwrap();fast.enable_sparse().unwrap();
            while !dense.advance(31,|_|{}).unwrap() {}
            while !fast.advance(3,|_|{}).unwrap() {}
            assert!(fast.exact_sparse());assert!(!fast.used_dense_fallback());
            assert_eq!(fast.trace,dense.trace,"seed {seed}, probability {probability}");
            assert!(fast.progress().neuron_updates<dense.progress().neuron_updates);
            let encode=|s:SimSession<'_>|encode_response(&s.finalize().unwrap(),n,0,256).unwrap();
            assert_eq!(encode(fast),encode(dense));
        }}
    }
}
