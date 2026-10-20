//! Reusable borrowed model and bounded session ABI. The Worker owns input allocations.
use super::*;

pub struct ModelHandle {
    graph: Graph<'static>,
    metadata: ModelMeta,
    active: usize,
}
pub struct AbiSession {
    model: *mut ModelHandle,
    task: Task,
    simulation: Option<SimSession<'static>>,
    response: Option<Response>,
    trace: Vec<CellTrace>,
    error: u32,
}
impl Drop for AbiSession {
    fn drop(&mut self) {
        // SAFETY: model_close refuses a handle with any live session.
        unsafe {
            (*self.model).active -= 1;
        }
    }
}

#[unsafe(no_mangle)]
/// # Safety
/// Both inputs are readable, immutable allocations kept alive until model_close succeeds.
/// A handle must be closed once, before freeing or replacing either input.
pub unsafe extern "C" fn flypow_model_open(
    g: *const u8,
    gl: u32,
    m: *const u8,
    ml: u32,
) -> *mut ModelHandle {
    if g.is_null() || m.is_null() {
        return std::ptr::null_mut();
    }
    let gb = unsafe { std::slice::from_raw_parts(g, gl as usize) };
    let mb = unsafe { std::slice::from_raw_parts(m, ml as usize) };
    let Ok(graph) = Graph::parse(gb) else {
        return std::ptr::null_mut();
    };
    let Ok(metadata) = ModelMeta::parse(mb, &graph) else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(ModelHandle {
        graph,
        metadata,
        active: 0,
    }))
}
#[unsafe(no_mangle)]
/// # Safety
/// handle is live and returned by model_open. Failure leaves it alive.
pub unsafe extern "C" fn flypow_model_close(handle: *mut ModelHandle) -> u32 {
    if handle.is_null() || unsafe { (*handle).active } != 0 {
        return 0;
    }
    drop(unsafe { Box::from_raw(handle) });
    1
}
#[unsafe(no_mangle)]
/// # Safety
/// model is live. selection is count readable u32s (or null with count=0).
/// The returned session must be freed once, before closing its model.
pub unsafe extern "C" fn flypow_session_begin(
    model: *mut ModelHandle,
    body: u64,
    steps: u32,
    observe_start: u32,
    parameter_version: u32,
    start: u32,
    end: u32,
    current: i64,
    seed: u64,
    archive_limit: u32,
    selection: *const u32,
    count: u32,
) -> *mut AbiSession {
    if model.is_null()
        || parameter_version != 1
        || observe_start != 0
        || steps > 512
        || count > 64
        || (count > 0 && selection.is_null())
    {
        return std::ptr::null_mut();
    }
    if unsafe { (*model).active } != 0 {
        return std::ptr::null_mut();
    }
    let graph = unsafe { &(*model).graph };
    let metadata = unsafe { &(*model).metadata };
    let mut lo = 0;
    let mut hi = graph.neuron_count;
    while lo < hi {
        let mid = (lo + hi) / 2;
        if graph.body_id(mid) < body {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if lo == graph.neuron_count || graph.body_id(lo) != body {
        return std::ptr::null_mut();
    }
    let selection = if count == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(selection, count as usize) }
    };
    let task = Task {
        target_index: lo,
        steps,
        observe_start,
        stimulus_start: start,
        stimulus_end: end,
        stimulus_current: current,
        public_seed: seed,
    };
    let Ok(simulation) = SimSession::new(
        graph,
        &metadata.signs,
        &metadata.vnc,
        &metadata.roi_masks,
        Parameters::development_v0(),
        task,
        archive_limit as usize,
        selection,
        count as usize * steps as usize * 2,
    ) else {
        return std::ptr::null_mut();
    };
    report_wasm_progress(simulation.progress());
    unsafe {
        (*model).active += 1;
    }
    Box::into_raw(Box::new(AbiSession {
        model,
        task,
        simulation: Some(simulation),
        response: None,
        trace: Vec::new(),
        error: 0,
    }))
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live and unadvanced. Returns 1 only after invariant admission;
/// failure keeps the dense session intact. Archive identities are unchanged.
pub unsafe extern "C" fn flypow_session_use_exact_events(session: *mut AbiSession) -> u32 {
    if session.is_null() { return 0; }
    unsafe { (*session).simulation.as_mut().is_some_and(|s| s.enable_sparse().is_ok()) as u32 }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. 0=failure, 1=incomplete, 2=complete. No work follows failure.
pub unsafe extern "C" fn flypow_session_advance(session: *mut AbiSession, budget: u32) -> u32 {
    if session.is_null() {
        return 0;
    }
    let s = unsafe { &mut *session };
    if s.error != 0 {
        return 0;
    }
    if s.response.is_some() {
        return 2;
    }
    let Some(sim) = s.simulation.as_mut() else {
        return 0;
    };
    match sim.advance(budget as usize, report_wasm_progress) {
        Ok(false) => 1,
        Ok(true) => {
            let mut sim = s.simulation.take().expect("live simulation");
            s.trace = std::mem::take(&mut sim.trace);
            match sim.finalize() {
                Ok(response) => {
                    s.response = Some(response);
                    2
                }
                Err(_) => {
                    s.error = 2;
                    0
                }
            }
        }
        Err(e) => {
            s.error = if e == SimError::ResourceLimit { 1 } else { 2 };
            0
        }
    }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. Partial updates are separate from completed-step counters.
pub unsafe extern "C" fn flypow_session_partial(session: *const AbiSession) -> u32 {
    if session.is_null() {
        return 0;
    }
    unsafe {
        (*session)
            .simulation
            .as_ref()
            .map_or(0, SimSession::partial_neuron_updates)
    }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. 1=resource cap, 2=numeric/state failure.
pub unsafe extern "C" fn flypow_session_error(session: *const AbiSession) -> u32 {
    if session.is_null() {
        2
    } else {
        unsafe { (*session).error }
    }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. Includes actual additions in the partial step.
pub unsafe extern "C" fn flypow_session_work_synapses(session: *const AbiSession) -> u64 {
    if session.is_null() { return 0; }
    unsafe { (*session).simulation.as_ref().map_or(0, SimSession::work_synapse_additions) }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. Returns zero until a full response exists.
pub unsafe extern "C" fn flypow_session_output_length(session: *const AbiSession) -> u32 {
    if session.is_null() {
        return 0;
    }
    unsafe {
        (*session)
            .response
            .as_ref()
            .and_then(|r| response_length(r).ok())
            .unwrap_or(0)
    }
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live; output is capacity writable bytes. Read chunks before freeing session.
pub unsafe extern "C" fn flypow_session_read_output(
    session: *const AbiSession,
    offset: u32,
    output: *mut u8,
    capacity: u32,
) -> u32 {
    if session.is_null() || output.is_null() || capacity == 0 {
        return 0;
    }
    let s = unsafe { &*session };
    let Some(response) = s.response.as_ref() else {
        return 0;
    };
    let n = unsafe { (*s.model).graph.neuron_count };
    let out = unsafe { std::slice::from_raw_parts_mut(output, capacity as usize) };
    write_response_range(
        response,
        n as u32,
        s.task.target_index as u32,
        s.task.steps,
        offset as usize,
        out,
    )
    .unwrap_or(0) as u32
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live. The returned count includes only actual recorded core ticks.
pub unsafe extern "C" fn flypow_session_trace_count(session: *const AbiSession) -> u32 {
    if session.is_null() {
        return 0;
    }
    let s = unsafe { &*session };
    s.simulation
        .as_ref()
        .map_or(s.trace.len(), |x| x.trace.len()) as u32
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live; output has max_rows*TRACE_ROW_BYTES writable bytes.
/// The call copies bounded rows, so later advance or memory.grow cannot invalidate them.
pub unsafe extern "C" fn flypow_session_read_trace(
    session: *const AbiSession,
    start: u32,
    output: *mut u8,
    max_rows: u32,
) -> u32 {
    if session.is_null() || output.is_null() || max_rows == 0 {
        return 0;
    }
    let s = unsafe { &*session };
    let rows = s.simulation.as_ref().map_or(&s.trace, |x| &x.trace);
    let start = start as usize;
    if start >= rows.len() {
        return 0;
    }
    let count = (rows.len() - start).min(max_rows as usize);
    let out = unsafe { std::slice::from_raw_parts_mut(output, count * TRACE_ROW_BYTES) };
    for (row, bytes) in rows[start..start + count]
        .iter()
        .zip(out.chunks_exact_mut(TRACE_ROW_BYTES))
    {
        row.encode(bytes);
    }
    count as u32
}
#[unsafe(no_mangle)]
/// # Safety
/// session is live; free once. This releases all task state, trace and scientific events.
pub unsafe extern "C" fn flypow_session_free(session: *mut AbiSession) {
    if !session.is_null() {
        drop(unsafe { Box::from_raw(session) });
    }
}

pub fn response_length(response: &Response) -> Result<u32, SimError> {
    let len = response
        .spikes_a
        .len()
        .checked_add(response.spikes_b.len())
        .and_then(|n| n.checked_mul(8))
        .and_then(|n| n.checked_add(480))
        .ok_or(SimError::NumericRange)?;
    u32::try_from(len).map_err(|_| SimError::NumericRange)
}
/// Fixed header, all A events, all B events. Byte ranges are compatible with FBRP1.
pub fn write_response_range(
    response: &Response,
    n: u32,
    target: u32,
    steps: u32,
    start: usize,
    out: &mut [u8],
) -> Result<usize, SimError> {
    let total = response_length(response)? as usize;
    if start >= total {
        return Ok(0);
    }
    let count = out.len().min(total - start);
    // A small header allocation replaces the old complete encoding/copy path.
    let header = encode_response_header(response, n, target, steps)?;
    let a = response.spikes_a.len();
    for (i, dst) in out[..count].iter_mut().enumerate() {
        let at = start + i;
        if at < 480 {
            *dst = header[at];
        } else {
            let index = (at - 480) / 8;
            let byte = (at - 480) % 8;
            let event = if index < a {
                &response.spikes_a[index]
            } else {
                &response.spikes_b[index - a]
            };
            *dst = if byte < 4 {
                event.step.to_le_bytes()[byte]
            } else {
                event.neuron_index.to_le_bytes()[byte - 4]
            };
        }
    }
    Ok(count)
}
