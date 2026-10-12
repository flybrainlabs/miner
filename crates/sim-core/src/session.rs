use super::*;

/// A read-only observation of the SAME tick. Model units, not mV/pA.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellTrace {
    pub step: u32,
    pub index: u32,
    pub lane: u8,
    pub spike: bool,
    pub refractory_before: u8,
    pub refractory_after: u8,
    pub incoming: i64,
    pub background: i64,
    pub stimulus: i64,
    pub membrane_before: i64,
    pub leaked: i64,
    pub integrated: i64,
    pub membrane_after: i64,
}
pub const TRACE_ROW_BYTES: usize = 72;
impl CellTrace {
    pub fn encode(&self, out: &mut [u8]) {
        out.fill(0);
        out[0..4].copy_from_slice(&self.step.to_le_bytes());
        out[4..8].copy_from_slice(&self.index.to_le_bytes());
        out[8] = self.lane;
        out[9] = u8::from(self.spike);
        out[10] = self.refractory_before;
        out[11] = self.refractory_after;
        for (i, v) in [
            self.incoming,
            self.background,
            self.stimulus,
            self.membrane_before,
            self.leaked,
            self.integrated,
            self.membrane_after,
        ]
        .iter()
        .enumerate()
        {
            out[12 + i * 8..20 + i * 8].copy_from_slice(&v.to_le_bytes());
        }
    }
}

/// Owns mutable task state. Borrowed frozen model remains alive until disposal.
/// Every advance budget counts a neuron pair or one actual outgoing edge visit.
/// A half step retains its cell/edge cursor and both delay buffers.
pub struct SimSession<'a> {
    graph: &'a Graph<'a>,
    signs: &'a [i8],
    vnc: &'a [bool],
    roi_masks: &'a [u16],
    parameters: Parameters,
    task: Task,
    membrane_a: Vec<i64>,
    membrane_b: Vec<i64>,
    refractory_a: Vec<u8>,
    refractory_b: Vec<u8>,
    incoming_a: Vec<i64>,
    incoming_b: Vec<i64>,
    next_a: Vec<i64>,
    next_b: Vec<i64>,
    active_a: Vec<bool>,
    active_b: Vec<bool>,
    deltas: Vec<i32>,
    first_divergence: Vec<Option<u32>>,
    global: GlobalSummary,
    roi: [i64; 16],
    time: [i32; 32],
    spikes_a: Vec<SpikeEvent>,
    spikes_b: Vec<SpikeEvent>,
    progress: SimProgress,
    transmissions: u64,
    cell: usize,
    edge: usize,
    edge_end: usize,
    fire_a: bool,
    fire_b: bool,
    archive_limit: usize,
    trace_mask: Vec<bool>,
    trace_limit: usize,
    pub trace: Vec<CellTrace>,
}
impl<'a> SimSession<'a> {
    #[allow(clippy::too_many_arguments)] // Frozen graph, physiology, task and independent observation budgets.
    pub fn new(
        graph: &'a Graph<'a>,
        signs: &'a [i8],
        vnc: &'a [bool],
        roi_masks: &'a [u16],
        parameters: Parameters,
        task: Task,
        archive_limit: usize,
        selection: &[u32],
        trace_limit: usize,
    ) -> Result<Self, SimError> {
        parameters.validate()?;
        let n = graph.neuron_count;
        if signs.len() != n
            || vnc.len() != n
            || roi_masks.len() != n
            || signs.iter().any(|s| *s != -1 && *s != 1)
        {
            return Err(SimError::ModelShape);
        }
        if task.target_index >= n
            || task.steps < 32
            || task.observe_start >= task.steps
            || task.stimulus_start >= task.stimulus_end
            || task.stimulus_end > task.steps
            || task.stimulus_current < 0
        {
            return Err(SimError::TaskRange);
        }
        let observed = task.steps - task.observe_start;
        let widest_bin = observed.div_ceil(32);
        if (n as u64)
            .checked_mul(u64::from(widest_bin))
            .ok_or(SimError::NumericRange)?
            > i32::MAX as u64
            || observed > i32::MAX as u32
        {
            return Err(SimError::NumericRange);
        }
        let membrane_a = vec![parameters.reset; n];
        let membrane_b = vec![parameters.reset; n];
        let refractory_a = vec![0_u8; n];
        let refractory_b = vec![0_u8; n];
        let incoming_a = vec![0_i64; n];
        let incoming_b = vec![0_i64; n];
        let next_a = vec![0_i64; n];
        let next_b = vec![0_i64; n];
        let active_a = vec![false; n];
        let active_b = vec![false; n];
        let deltas = vec![0_i32; n];
        let first_divergence = vec![None::<u32>; n];
        let global = GlobalSummary::default();
        let roi = [0_i64; 16];
        let time = [0_i32; 32];
        let spikes_a = Vec::new();
        let spikes_b = Vec::new();
        let progress = SimProgress {
            completed_steps: 0,
            total_steps: task.steps,
            neuron_updates: 0,
            synapse_transmissions: 0,
            observed_spikes_a: 0,
            observed_spikes_b: 0,
        };
        if archive_limit < 480
            || selection.len() > 64
            || selection.windows(2).any(|w| w[0] >= w[1])
            || selection.iter().any(|i| *i as usize >= n)
            || (!selection.is_empty() && trace_limit < selection.len() * 2 * task.steps as usize)
        {
            return Err(SimError::ResourceLimit);
        }
        let mut trace_mask = vec![false; n];
        for i in selection {
            trace_mask[*i as usize] = true;
        }
        Ok(Self {
            graph,
            signs,
            vnc,
            roi_masks,
            parameters,
            task,
            membrane_a,
            membrane_b,
            refractory_a,
            refractory_b,
            incoming_a,
            incoming_b,
            next_a,
            next_b,
            active_a,
            active_b,
            deltas,
            first_divergence,
            global,
            roi,
            time,
            spikes_a,
            spikes_b,
            progress,
            transmissions: 0,
            cell: 0,
            edge: 0,
            edge_end: 0,
            fire_a: false,
            fire_b: false,
            archive_limit,
            trace_mask,
            trace_limit,
            trace: Vec::new(),
        })
    }
    pub fn progress(&self) -> SimProgress {
        self.progress
    }
    pub fn partial_neuron_updates(&self) -> u32 {
        (2 * self.cell) as u32
    }
    /// Actual additions, including the current incomplete simulation step.
    /// Observation only; the response and scientific identity are unchanged.
    pub fn work_synapse_additions(&self) -> u64 {
        self.transmissions
    }
    pub fn done(&self) -> bool {
        self.progress.completed_steps == self.task.steps
    }
    fn push_event(&mut self, a: bool, event: SpikeEvent) -> Result<(), SimError> {
        if 480 + 8 * (self.spikes_a.len() + self.spikes_b.len() + 1) > self.archive_limit {
            return Err(SimError::ResourceLimit);
        }
        let events = if a {
            &mut self.spikes_a
        } else {
            &mut self.spikes_b
        };
        if events.len() == events.capacity() {
            events
                .try_reserve(65536.min((self.archive_limit - 480) / 8 - events.len()))
                .map_err(|_| SimError::ResourceLimit)?;
        }
        events.push(event);
        Ok(())
    }
    pub fn advance(
        &mut self,
        budget: usize,
        mut observer: impl FnMut(SimProgress),
    ) -> Result<bool, SimError> {
        if budget == 0 {
            return Err(SimError::TaskRange);
        }
        let n = self.graph.neuron_count;
        let mut work = 0;
        while !self.done() && work < budget {
            if self.edge < self.edge_end {
                let (target, weight) = self.graph.edge(self.edge);
                let current = i64::from(weight)
                    .checked_mul(self.parameters.synaptic_unit)
                    .and_then(|v| v.checked_mul(i64::from(self.signs[self.cell - 1])))
                    .ok_or(SimError::NumericRange)?;
                if self.fire_a {
                    self.next_a[target] = self.next_a[target]
                        .checked_add(current)
                        .ok_or(SimError::NumericRange)?;
                    self.transmissions = self.transmissions.saturating_add(1);
                }
                if self.fire_b {
                    self.next_b[target] = self.next_b[target]
                        .checked_add(current)
                        .ok_or(SimError::NumericRange)?;
                    self.transmissions = self.transmissions.saturating_add(1);
                }
                self.edge += 1;
                work += 1;
                continue;
            }
            if self.cell == n {
                std::mem::swap(&mut self.incoming_a, &mut self.next_a);
                std::mem::swap(&mut self.incoming_b, &mut self.next_b);
                self.next_a.fill(0);
                self.next_b.fill(0);
                self.cell = 0;
                self.progress.completed_steps += 1;
                self.progress.neuron_updates =
                    2 * n as u64 * u64::from(self.progress.completed_steps);
                self.progress.synapse_transmissions = self.transmissions;
                self.progress.observed_spikes_a = self.global.spikes_a;
                self.progress.observed_spikes_b = self.global.spikes_b;
                observer(self.progress);
                continue;
            }
            let index = self.cell;
            let step = self.progress.completed_steps;
            let observed_step = step >= self.task.observe_start;
            let observed = self.task.steps - self.task.observe_start;
            let bin = if observed_step {
                (((u64::from(step - self.task.observe_start) + 1) * 32 - 1) / u64::from(observed))
                    as usize
            } else {
                0
            };
            let record = self.trace_mask[index];
            let before_a = self.membrane_a[index];
            let before_b = self.membrane_b[index];
            let ref_a = self.refractory_a[index];
            let ref_b = self.refractory_b[index];
            let entropy = splitmix64(
                self.task.public_seed
                    ^ self.graph.body_id(index)
                    ^ u64::from(step).wrapping_mul(0xd6e8feb86659fd93),
            );
            let background =
                if (entropy & 0xffff) < u64::from(self.parameters.background_probability_u16) {
                    self.parameters.background_current
                } else {
                    0
                };
            let drive_a = self.incoming_a[index]
                .checked_add(background)
                .ok_or(SimError::NumericRange)?;
            let stimulation = if index == self.task.target_index
                && step >= self.task.stimulus_start
                && step < self.task.stimulus_end
            {
                self.task.stimulus_current
            } else {
                0
            };
            let drive_b = self.incoming_b[index]
                .checked_add(background)
                .and_then(|value| value.checked_add(stimulation))
                .ok_or(SimError::NumericRange)?;
            let tick_a = tick(
                &mut self.membrane_a[index],
                &mut self.refractory_a[index],
                drive_a,
                self.parameters,
            )?;
            let tick_b = tick(
                &mut self.membrane_b[index],
                &mut self.refractory_b[index],
                drive_b,
                self.parameters,
            )?;
            let a = tick_a.spike;
            let b = tick_b.spike;
            if observed_step {
                if a {
                    self.global.spikes_a += 1;
                    if !self.active_a[index] {
                        self.global.active_a += 1;
                        self.active_a[index] = true;
                    }
                    if index == self.task.target_index {
                        self.global.target_spikes_a += 1;
                    }
                    if self.vnc[index] {
                        self.global.vnc_spikes_a += 1;
                    }
                    self.push_event(
                        true,
                        SpikeEvent {
                            step,
                            neuron_index: index as u32,
                        },
                    )?;
                }
                if b {
                    self.global.spikes_b += 1;
                    if !self.active_b[index] {
                        self.global.active_b += 1;
                        self.active_b[index] = true;
                    }
                    if index == self.task.target_index {
                        self.global.target_spikes_b += 1;
                    }
                    if self.vnc[index] {
                        self.global.vnc_spikes_b += 1;
                    }
                    self.push_event(
                        false,
                        SpikeEvent {
                            step,
                            neuron_index: index as u32,
                        },
                    )?;
                }
                let delta = i32::from(b) - i32::from(a);
                self.deltas[index] += delta;
                self.time[bin] = self.time[bin]
                    .checked_add(delta)
                    .ok_or(SimError::NumericRange)?;
                for (roi_index, roi_value) in self.roi.iter_mut().enumerate() {
                    if self.roi_masks[index] & (1 << roi_index) != 0 {
                        *roi_value += i64::from(delta);
                    }
                }
                if a != b && self.first_divergence[index].is_none() {
                    self.first_divergence[index] = Some(step);
                }
            }
            if record {
                if self.trace.len() + 2 > self.trace_limit {
                    return Err(SimError::ResourceLimit);
                }
                if self.trace.capacity() < self.trace.len() + 2 {
                    self.trace
                        .try_reserve(128)
                        .map_err(|_| SimError::ResourceLimit)?;
                }
                for (lane, before, ref_before, tick, incoming, stimulus, after, ref_after) in [
                    (
                        0,
                        before_a,
                        ref_a,
                        tick_a,
                        self.incoming_a[index],
                        0,
                        self.membrane_a[index],
                        self.refractory_a[index],
                    ),
                    (
                        1,
                        before_b,
                        ref_b,
                        tick_b,
                        self.incoming_b[index],
                        stimulation,
                        self.membrane_b[index],
                        self.refractory_b[index],
                    ),
                ] {
                    self.trace.push(CellTrace {
                        step,
                        index: index as u32,
                        lane,
                        spike: tick.spike,
                        refractory_before: ref_before,
                        refractory_after: ref_after,
                        incoming,
                        background,
                        stimulus,
                        membrane_before: before,
                        leaked: tick.leaked,
                        integrated: tick.integrated,
                        membrane_after: after,
                    });
                }
            }
            self.fire_a = a;
            self.fire_b = b;
            self.cell += 1;
            work += 1;
            self.edge = if a || b { self.graph.offset(index) } else { 0 };
            self.edge_end = if a || b {
                self.graph.offset(index + 1)
            } else {
                0
            };
        }
        Ok(self.done())
    }
    pub fn finalize(self) -> Result<Response, SimError> {
        if !self.done() {
            return Err(SimError::TaskRange);
        }
        let mut changed: Vec<usize> = self
            .first_divergence
            .iter()
            .enumerate()
            .filter_map(|(index, first)| first.map(|_| index))
            .collect();
        changed.sort_unstable_by_key(|index| {
            (
                -(i64::from(self.deltas[*index]).abs()),
                self.graph.body_id(*index),
            )
        });
        let mut top = [TopNeuron::default(); 8];
        let top_count = changed.len().min(8) as u8;
        for (slot, index) in changed.into_iter().take(8).enumerate() {
            top[slot] = TopNeuron {
                body_id: self.graph.body_id(index),
                delta_spikes: self.deltas[index],
                first_divergence_step: self.first_divergence[index]
                    .expect("selected diverged cell"),
            };
        }
        Ok(Response {
            global: self.global,
            roi_delta_spikes: self.roi,
            population_delta_by_bin: self.time,
            top,
            top_count,
            spikes_a: self.spikes_a,
            spikes_b: self.spikes_b,
        })
    }
}
